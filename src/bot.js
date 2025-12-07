import 'dotenv/config';
import axios from 'axios';
import { I18n } from '@grammyjs/i18n';
import { Bot, session, InlineKeyboard } from 'grammy';
import { uploadToR2 } from './r2.js';
import { format } from 'date-fns';
import { appendToSheet } from './sheet.js';

const MAX_SIZE = 15 * 1024 * 1024; // 15 МБ

const bot = new Bot(process.env.BOT_TOKEN);

const i18n = new I18n({
  defaultLocale: 'ru',
  useSession: true,
  directory: 'locales',
});

bot.use(i18n);

// нужен для хранения сессии заявки мидлвара
bot.use(
  session({
    initial: () => ({
      step: null, // Track the current step
      formData: {}, // Store the user input
    }),
  })
);

bot.command('start', async (ctx) => {
  const keyboard = new InlineKeyboard()
    .text('Русский', 'lang_ru')
    .text('English', 'lang_en');

  await ctx.reply(ctx.t('choose_language'), {
    reply_markup: keyboard,
  });
});

bot.callbackQuery(['lang_ru', 'lang_en'], async (ctx) => {
  const newLang = ctx.callbackQuery.data === 'lang_ru' ? 'ru' : 'en';

  await ctx.i18n.setLocale(newLang);
  await ctx.answerCallbackQuery();

  const keyboard = new InlineKeyboard().text(ctx.t('apply'), 'apply');

  try {
    await ctx.reply(ctx.t('about'), {
      reply_markup: keyboard,
    });
  } catch (error) {
    if (
      error.error_code === 403 &&
      error.description.includes('bot was blocked by the user')
    ) {
      console.log(`User with chat ID ${ctx.chat.id} has blocked the bot.`);
    } else {
      console.error('Error sending message:', error);
      try {
        await ctx.reply(
          'Произошла ошибка при отправке сообщения. Пожалуйста, попробуйте снова.'
        );
      } catch (err) {
        console.error('Error sending fallback message:', err);
      }
    }
  }
});

bot.callbackQuery('apply', (ctx) => {
  try {
    ctx.answerCallbackQuery();
    ctx.session.step = 'bioInfo';
    ctx.reply(ctx.t('author'));
  } catch (error) {
    console.log(error);
  }
});

async function showEditMenu(ctx) {
  try {
    const keyboard = new InlineKeyboard()
      .text(ctx.t('edit_name'), 'editBio')
      .text(ctx.t('edit_social'), 'editSocialMedia')
      .row()
      .text(ctx.t('edit_voice_name'), 'editVoiceName')
      .text(ctx.t('edit_comment'), 'editComment')
      .row()
      .text(ctx.t('edit_audio'), 'editAudio')
      .row()
      .text('Сохранить и отправить', 'saveAndSend');
    const allInfoRU = `Имя: ${ctx.session.formData.author}\nСсылка на соцсеть: ${ctx.session.formData.socialMedia}\nНазвание: ${ctx.session.formData.voiceName}\nКомментарий: ${ctx.session.formData.comment}\n`;
    // переписать на английский
    const allInfoEN = `Имя: ${ctx.session.formData.author}\nСсылка на соцсеть: ${ctx.session.formData.socialMedia}\nНазвание: ${ctx.session.formData.voiceName}\nКомментарий: ${ctx.session.formData.comment}\n`;
    const allInfo = ctx.i18n.locale === 'ru' ? allInfoRU : allInfoEN;
    await ctx.reply(`${allInfo}\n\n Выберите, что нужно отредактировать:`, {
      reply_markup: keyboard,
    });
  } catch (error) {
    console.log(error);
  }
}

bot.callbackQuery("edit", async (ctx) => {
  try {
    ctx.answerCallbackQuery();
    await showEditMenu(ctx);
  } catch (error) {
    console.log(error);
  }
});

bot.callbackQuery("editBio", async (ctx) => {
  try {
    ctx.session.step = "bioInfo";
    ctx.reply(ctx.t('author'));
  } catch (error) {
    console.log(error);
  }
});

bot.callbackQuery("editSocialMedia", async (ctx) => {
  try {
    ctx.session.step = "socialMedia";
    ctx.reply(ctx.t('social_media'));
  } catch (error) {
    console.log(error);
  }
});

bot.callbackQuery("editVoiceName", (ctx) => {
  try {
    ctx.session.step = "voiceName";
    ctx.reply(ctx.t('voice_name'));
  } catch (error) {
    console.log(error);
  }
});

bot.callbackQuery("editComment", async (ctx) => {
  try {
    ctx.session.step = "comment";
    ctx.reply(ctx.t('comment'));
  } catch (error) {
    console.log(error);
  }
});

bot.callbackQuery("editAudio", async (ctx) => {
  try {
    ctx.session.step = "waiting_for_audio";
    ctx.session.formData.temp_audio = null;
    ctx.reply(ctx.t('send_audio'));
  } catch (error) {
    console.log(error);
  }
});

bot.on(['message:audio', 'message:voice'], async (ctx) => {
  if (ctx.session.step !== 'waiting_for_audio') {
    return;
  }
  let fileId;
  let mimeType;
  let fileExtension;
  let fileSize;

  if (ctx.message.audio) {
    fileId = ctx.message.audio.file_id;
    mimeType = ctx.message.audio.mime_type || 'audio/mpeg';

    const fileName = ctx.message.audio.file_name || '';
    fileExtension = fileName.split('.').pop() || 'mp3';
    fileSize = ctx.message.audio.file_size;
  } else if (ctx.message.voice) {
    fileId = ctx.message.voice.file_id;
    mimeType = ctx.message.voice.mime_type || 'audio/ogg';
    fileExtension = 'ogg';
    fileSize = ctx.message.voice.file_size;
  } else {
    await ctx.reply(
      '❌ Неверный формат файла. Пожалуйста, отправьте голосовое сообщение или аудио.'
    );
    return;
  }

  if (ctx.message.audio && !['mp3', 'ogg', 'oga'].includes(fileExtension)) {
    await ctx.reply(
      '❌ Разрешены только файлы с расширением .mp3, .ogg или .oga'
    );
    return;
  }

  if (fileSize && fileSize > MAX_SIZE) {
    await ctx.reply('❌ Файл слишком большой. Максимальный размер — 15 МБ.');
    return;
  }

  ctx.session.formData.temp_audio = {
    fileId,
    mimeType,
    fileExtension,
  };

  const keyboard = new InlineKeyboard().text(
    ctx.t('ready'),
    'confirmSubmission'
  );
  ctx.reply('!', {
    reply_markup: keyboard,
  });
  ctx.session.step = 'confirmSubmission';
});

bot.on('message', async (ctx) => {
  try {
    const session = ctx.session;

    if (session.step === 'bioInfo') {
      session.formData.user_id = ctx.message.from.id;
      session.formData.username = ctx.message.from.username;
      session.formData.author = ctx.message.text;

      if (!session.formData.socialMedia) {
        ctx.reply(ctx.t('social_media'));
        session.step = 'socialMedia';
      } else {
        showEditMenu(ctx)
      }
    } else if (session.step === 'socialMedia') {
      session.formData.socialMedia = ctx.message.text;

      if (!session.formData.voiceName) {
        ctx.reply(ctx.t('voice_name'));
        session.step = 'voiceName';
      } else {
        showEditMenu(ctx)
      }
    } else if (session.step === 'voiceName') {
      session.formData.voiceName = ctx.message.text;

      if (!session.formData.comment) {
        ctx.reply(ctx.t('comment'));
        session.step = 'comment';
      } else {
        showEditMenu(ctx)
      }
    } else if (session.step === 'comment') {
      session.formData.comment = ctx.message.text;
      if (!session.formData.file) {
        ctx.reply(ctx.t('send_audio'));
        session.step = 'waiting_for_audio';
      } else {
        showEditMenu(ctx)
      }
    } else if (session.step === 'waiting_for_audio') {
      ctx.reply(
        '❌ Пожалуйста, отправьте голосовое сообщение или аудиофайл.'
      );
    }
  } catch (error) {
    console.log(error);
  }
});

bot.callbackQuery('confirmSubmission', async (ctx) => {
  try {
    const session = ctx.session;
    ctx.answerCallbackQuery();
    if (session.formData.temp_audio) {
      const keyboard = new InlineKeyboard()
        .text(ctx.t('edit'), 'edit')
        .text(ctx.t('save'), 'saveAndSend');
      const allInfoRU = `Имя: ${session.formData.author}\nлаша на соцсеть: ${ctx.session.formData.socialMedia}\nНазвание работы: ${ctx.session.formData.voiceName}\nОписание работы: ${session.formData.comment}\n\nНажимая отправить вы соглашаетесь на предоставление информации организаторам опенколла.`;
      // переписать на английский
      const allInfoEN = `Имя: ${session.formData.author}\nлаша на соцсеть: ${ctx.session.formData.socialMedia}\nНазвание работы: ${ctx.session.formData.voiceName}\nОписание работы: ${session.formData.comment}\n\nНажимая отправить вы соглашаетесь на предоставление информации организаторам опенколла.`;
      const allInfo = ctx.i18n.locale === 'ru' ? allInfoRU : allInfoEN;
      ctx.reply(allInfo, {
        reply_markup: keyboard,
      });
    } else {
      ctx.reply('Пожалуйста, загрузите аудиофайл перед отправкой заявки.');
      session.step = 'waiting_for_audio';
    }
  } catch (error) {
    console.log(error);
  }
});

bot.callbackQuery('saveAndSend', async (ctx) => {
  try {
    const session = ctx.session;
    ctx.answerCallbackQuery();
    ctx.reply(ctx.t('saving'));
    if (session.formData.temp_audio) {
      const { fileId, mimeType, fileExtension } = session.formData.temp_audio;
      try {
        const fileInfo = await ctx.api.getFile(fileId);
        const downloadUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${fileInfo.file_path}`;

        const response = await axios.get(downloadUrl, {
          responseType: 'arraybuffer',
        });
        const fileBuffer = Buffer.from(response.data);

        if (fileBuffer.length > MAX_SIZE) {
          await ctx.reply(
            '❌ Файл слишком большой. Максимальный размер — 15 МБ.'
          );
          return;
        }

        const now = new Date();
        const formattedDate = format(now, 'yyyy-MM-dd_HH-mm-ss');

        const keyName = `${ctx.from.id}_${formattedDate}.${fileExtension}`;
        // console.log('Uploading file to R2 with key:', keyName);

        const url = await uploadToR2(fileBuffer, keyName, mimeType);

        const values = [];
        for (let key in session.formData) {
          if (key === 'username') {
            const userProfileLink = session.formData.username
              ? `=HYPERLINK("https://t.me/${session.formData.username}")`
              : 'No username';
            values.push(userProfileLink);
          } else if (key !== 'temp_audio') {
            values.push(session.formData[key]);
          } else {
            values.push(`=HYPERLINK("${url}")`);
          }
        }
        await appendToSheet(values);
        session.step = 'finalStep';
        const keyboard = new InlineKeyboard().url(
          'Телеграм канал collective(ism)',
          'https://t.me/collective_ism'
        );
        ctx.reply(ctx.t('submission_successful'), { reply_markup: keyboard });
        session.formData = {};
      } catch (error) {
        console.error(error);
        await ctx.reply(
          '❌ Произошла ошибка при загрузке файла. Попробуйте ещё раз.'
        );
      }
    }
  } catch (error) {}
});

bot.command('help', async (ctx) => {
  try {
    ctx.reply(
      'Если у вас возникли трудности c отправкой заявки на опенколл, попробуйте очистить историю диалога и заполнить информацию еще раз, если и это не помогло, напишите @mashak000'
    );
  } catch (error) {
    if (
      error.error_code === 403 &&
      error.description.includes('bot was blocked by the user')
    ) {
      console.log(`User with chatId ${ctx.chat.id} has blocked the bot.`);
    } else {
      console.error(`Failed to send message to ${ctx.chat.id}:`, error);
    }
  }
});

bot.start();
