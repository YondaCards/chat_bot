import { workflow, node, trigger, sticky, ifElse, switchCase, languageModel, outputParser, expr } from '@n8n/workflow-sdk';

const tgCred = { telegramApi: { id: 'i8evYyOAUjBo3Luu', name: 'Telegram account' } };
const geminiCred = { googlePalmApi: { id: '0P7gKaEnFx7Wj1dP', name: 'Google Gemini(PaLM) Api account' } };
const leadsTable = { __rl: true, mode: 'id', value: 'wRVvqouuZVpKI1G0', cachedResultName: 'yonda_leads' };
const msgsTable = { __rl: true, mode: 'id', value: '0LvOQFdodU8uLaNn', cachedResultName: 'yonda_messages' };
const managersChatId = '-5019520873';

const tgIn = trigger({
  type: 'n8n-nodes-base.telegramTrigger',
  version: 1.5,
  config: {
    name: 'Telegram: входящие',
    parameters: { updates: ['message', 'callback_query'], additionalFields: {} },
    credentials: tgCred,
    position: [0, 300]
  },
  output: [{ update_id: 1, message: { message_id: 10, date: 1791460000, chat: { id: 111, type: 'private', username: 'client' }, from: { id: 111, first_name: 'Малика', username: 'client' }, text: 'Привет' } }]
});

const routeUpdate = switchCase({
  version: 3.4,
  config: {
    name: 'Тип обновления',
    position: [220, 300],
    parameters: {
      mode: 'rules',
      rules: {
        values: [
          { renameOutput: true, outputKey: 'Кнопка менеджера', conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' }, conditions: [{ leftValue: expr('{{ $json.callback_query ? "yes" : "no" }}'), operator: { type: 'string', operation: 'equals' }, rightValue: 'yes' }], combinator: 'and' } },
          { renameOutput: true, outputKey: 'Клиент (личка)', conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' }, conditions: [{ leftValue: expr('{{ $json.message?.chat?.type ?? "" }}'), operator: { type: 'string', operation: 'equals' }, rightValue: 'private' }], combinator: 'and' } }
        ]
      },
      options: {}
    }
  }
});

const normalize = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Нормализация сообщения',
    position: [460, 400],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: `// Единый формат сообщения для любого канала (сейчас Telegram, потом Instagram)
const m = $input.first().json.message;
const raw = m.text || m.caption || '';
let kind = 'text';
if (m.voice || m.audio || m.video_note) kind = 'voice';
else if (m.photo) kind = 'photo';
else if (!m.text) kind = 'other';
let ad_ref = '';
let is_start = false;
if (raw.startsWith('/start')) { is_start = true; ad_ref = raw.slice(6).trim(); }
return [{ json: {
  channel: 'telegram',
  user_id: String(m.chat.id),
  username: m.from.username || '',
  name: [m.from.first_name, m.from.last_name].filter(Boolean).join(' '),
  text: is_start ? '' : raw,
  kind,
  ad_ref,
  is_start,
  msg_id: String(m.message_id),
  ts: new Date(m.date * 1000).toISOString()
} }];`
    }
  },
  output: [{ channel: 'telegram', user_id: '111', username: 'client', name: 'Малика', text: 'Привет', kind: 'text', ad_ref: '', is_start: false, msg_id: '10', ts: '2026-10-08T12:00:00.000Z' }]
});

const getLead = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Найти лида',
    position: [680, 400],
    alwaysOutputData: true,
    parameters: {
      resource: 'row',
      operation: 'get',
      dataTableId: leadsTable,
      matchType: 'allConditions',
      filters: { conditions: [{ keyName: 'user_id', condition: 'eq', keyValue: expr('{{ $json.user_id }}') }] },
      returnAll: false,
      limit: 1
    }
  },
  output: [{ id: 1, user_id: '111', status: 'Новый', paused: false, ad_ref: '' }]
});

const leadState = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Состояние лида',
    position: [900, 400],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: `// Объединяем новое сообщение с сохранённым состоянием лида и решаем, что делать
const msg = $('Нормализация сообщения').first().json;
const row = $input.first().json || {};
const exists = !!row.user_id;
const now = new Date();
let paused = exists && row.paused === true;
if (paused && row.paused_until && new Date(row.paused_until) <= now) paused = false;
let status = row.status || 'Новый';
if (!paused && status === 'Нужен менеджер') status = 'В диалоге';
let action = 'debounce';
if (paused) action = 'skip';
else if (msg.kind === 'voice') action = 'escalate';
else if (msg.is_start) action = 'greet';
return [{ json: {
  ...msg,
  is_new: !exists,
  paused,
  paused_until: paused ? row.paused_until : null,
  status,
  lead_ad_ref: msg.ad_ref || row.ad_ref || '',
  action
} }];`
    }
  },
  output: [{ user_id: '111', username: 'client', name: 'Малика', text: 'Привет', kind: 'text', msg_id: '10', ts: '2026-10-08T12:00:00.000Z', is_start: false, is_new: true, paused: false, paused_until: null, status: 'Новый', lead_ad_ref: '', action: 'debounce', channel: 'telegram' }]
});

const upsertLead = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Сохранить лида',
    position: [1120, 400],
    parameters: {
      resource: 'row',
      operation: 'upsert',
      dataTableId: leadsTable,
      matchType: 'allConditions',
      filters: { conditions: [{ keyName: 'user_id', condition: 'eq', keyValue: expr('{{ $json.user_id }}') }] },
      columns: {
        mappingMode: 'defineBelow',
        value: {
          user_id: expr('{{ $json.user_id }}'),
          channel: expr('{{ $json.channel }}'),
          username: expr('{{ $json.username }}'),
          name: expr('{{ $json.name }}'),
          ad_ref: expr('{{ $json.lead_ad_ref }}'),
          status: expr('{{ $json.status }}'),
          paused: expr('{{ $json.paused }}'),
          last_msg_at: expr('{{ $json.ts }}')
        },
        schema: [
          { id: 'user_id', displayName: 'user_id', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'channel', displayName: 'channel', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'username', displayName: 'username', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'name', displayName: 'name', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'ad_ref', displayName: 'ad_ref', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'status', displayName: 'status', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'paused', displayName: 'paused', required: false, defaultMatch: false, display: true, type: 'boolean', canBeUsedToMatch: true },
          { id: 'last_msg_at', displayName: 'last_msg_at', required: false, defaultMatch: false, display: true, type: 'dateTime', canBeUsedToMatch: true }
        ]
      }
    }
  },
  output: [{ id: 1, createdAt: '2026-10-08T12:00:00.000Z', updatedAt: '2026-10-08T12:00:00.000Z' }]
});

const saveUserMsg = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Сохранить сообщение клиента',
    position: [1340, 400],
    parameters: {
      resource: 'row',
      operation: 'insert',
      dataTableId: msgsTable,
      columns: {
        mappingMode: 'defineBelow',
        value: {
          user_id: expr("{{ $('Состояние лида').item.json.user_id }}"),
          channel: expr("{{ $('Состояние лида').item.json.channel }}"),
          role: 'user',
          text: expr("{{ $('Состояние лида').item.json.kind === 'text' ? $('Состояние лида').item.json.text : '[' + $('Состояние лида').item.json.kind + '] ' + $('Состояние лида').item.json.text }}"),
          msg_id: expr("{{ $('Состояние лида').item.json.msg_id }}"),
          batch_done: expr("{{ $('Состояние лида').item.json.action !== 'debounce' }}")
        },
        schema: [
          { id: 'user_id', displayName: 'user_id', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'channel', displayName: 'channel', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'role', displayName: 'role', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'text', displayName: 'text', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'msg_id', displayName: 'msg_id', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'batch_done', displayName: 'batch_done', required: false, defaultMatch: false, display: true, type: 'boolean', canBeUsedToMatch: true }
        ]
      }
    }
  },
  output: [{ id: 5, createdAt: '2026-10-08T12:00:00.000Z', updatedAt: '2026-10-08T12:00:00.000Z' }]
});

const routeAction = switchCase({
  version: 3.4,
  config: {
    name: 'Что делать',
    position: [1560, 400],
    parameters: {
      mode: 'rules',
      rules: {
        values: [
          { renameOutput: true, outputKey: 'Эскалация (голосовое)', conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' }, conditions: [{ leftValue: expr("{{ $('Состояние лида').item.json.action }}"), operator: { type: 'string', operation: 'equals' }, rightValue: 'escalate' }], combinator: 'and' } },
          { renameOutput: true, outputKey: 'Приветствие (/start)', conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' }, conditions: [{ leftValue: expr("{{ $('Состояние лида').item.json.action }}"), operator: { type: 'string', operation: 'equals' }, rightValue: 'greet' }], combinator: 'and' } },
          { renameOutput: true, outputKey: 'Склейка и ответ', conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' }, conditions: [{ leftValue: expr("{{ $('Состояние лида').item.json.action }}"), operator: { type: 'string', operation: 'equals' }, rightValue: 'debounce' }], combinator: 'and' } }
        ]
      },
      options: {}
    }
  }
});

const greet = node({
  type: 'n8n-nodes-base.telegram',
  version: 1.2,
  config: {
    name: 'Приветствие клиенту',
    position: [1800, 300],
    parameters: {
      resource: 'message',
      operation: 'sendMessage',
      chatId: expr("{{ $('Состояние лида').item.json.user_id }}"),
      text: expr("{{ $('Состояние лида').item.json.lead_ad_ref ? 'Здравствуйте! 🤍 Вижу, вас заинтересовал альбом ' + $('Состояние лида').item.json.lead_ad_ref + '. Расскажу о нём подробнее — напишите, что хотите узнать.' : 'Здравствуйте! Это Yonda Cards 🤍 Подскажу по альбомам и помогу оформить заказ. Что вас интересует?' }}\n\n(тестовый режим)"),
      replyMarkup: 'none',
      additionalFields: { appendAttribution: false }
    },
    credentials: tgCred
  },
  output: [{ ok: true, result: { message_id: 11 } }]
});

const waitDebounce = node({
  type: 'n8n-nodes-base.wait',
  version: 1.1,
  config: {
    name: 'Ждём 15 с (склейка)',
    position: [1800, 520],
    parameters: { resume: 'timeInterval', amount: 15, unit: 'seconds' }
  },
  output: [{ id: 5 }]
});

const getLatest = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Последнее сообщение клиента',
    position: [2020, 520],
    parameters: {
      resource: 'row',
      operation: 'get',
      dataTableId: msgsTable,
      matchType: 'allConditions',
      filters: { conditions: [
        { keyName: 'user_id', condition: 'eq', keyValue: expr("{{ $('Состояние лида').item.json.user_id }}") },
        { keyName: 'role', condition: 'eq', keyValue: 'user' }
      ] },
      returnAll: false,
      limit: 1,
      orderBy: true,
      orderByColumn: 'createdAt',
      orderByDirection: 'DESC'
    }
  },
  output: [{ id: 5, user_id: '111', role: 'user', text: 'Привет', msg_id: '10', batch_done: false }]
});

const isLatest = ifElse({
  version: 2.3,
  config: {
    name: 'Это последнее сообщение?',
    position: [2240, 520],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [{ leftValue: expr('{{ $json.msg_id }}'), operator: { type: 'string', operation: 'equals' }, rightValue: expr("{{ $('Состояние лида').item.json.msg_id }}") }],
        combinator: 'and'
      }
    }
  }
});

const getBatch = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Несклеенные сообщения',
    position: [2460, 520],
    parameters: {
      resource: 'row',
      operation: 'get',
      dataTableId: msgsTable,
      matchType: 'allConditions',
      filters: { conditions: [
        { keyName: 'user_id', condition: 'eq', keyValue: expr("{{ $('Состояние лида').item.json.user_id }}") },
        { keyName: 'role', condition: 'eq', keyValue: 'user' },
        { keyName: 'batch_done', condition: 'isFalse' }
      ] },
      returnAll: true,
      orderBy: true,
      orderByColumn: 'createdAt',
      orderByDirection: 'ASC'
    }
  },
  output: [{ id: 5, user_id: '111', role: 'user', text: 'Привет', msg_id: '10', batch_done: false }]
});

const combine = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Склейка и решение',
    position: [2680, 520],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: `// Склеиваем сообщения, пришедшие подряд, в один запрос к ИИ
const lead = $('Состояние лида').first().json;
const combined = $input.all().map(i => i.json.text).filter(Boolean).join('\\n');
return [{ json: {
  user_id: lead.user_id,
  username: lead.username,
  name: lead.name,
  ad_ref: lead.lead_ad_ref,
  status: lead.status,
  combined
} }];`
    }
  },
  output: [{ user_id: '111', username: 'client', name: 'Малика', ad_ref: '', status: 'Новый', combined: 'Привет' }]
});

const markDone = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Отметить сообщения склеенными',
    position: [2900, 700],
    parameters: {
      resource: 'row',
      operation: 'update',
      dataTableId: msgsTable,
      matchType: 'allConditions',
      filters: { conditions: [
        { keyName: 'user_id', condition: 'eq', keyValue: expr('{{ $json.user_id }}') },
        { keyName: 'batch_done', condition: 'isFalse' }
      ] },
      columns: {
        mappingMode: 'defineBelow',
        value: { batch_done: true },
        schema: [
          { id: 'batch_done', displayName: 'batch_done', required: false, defaultMatch: false, display: true, type: 'boolean', canBeUsedToMatch: true }
        ]
      }
    }
  },
  output: [{ id: 5 }]
});

const routeReply = switchCase({
  version: 3.4,
  config: {
    name: 'Ответить или позвать менеджера',
    position: [3780, 520],
    parameters: {
      mode: 'rules',
      rules: {
        values: [
          { renameOutput: true, outputKey: 'Ответ бота', conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' }, conditions: [{ leftValue: expr('{{ $json.action }}'), operator: { type: 'string', operation: 'equals' }, rightValue: 'reply' }], combinator: 'and' } },
          { renameOutput: true, outputKey: 'Эскалация (просьба)', conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' }, conditions: [{ leftValue: expr('{{ $json.action }}'), operator: { type: 'string', operation: 'equals' }, rightValue: 'escalate' }], combinator: 'and' } }
        ]
      },
      options: {}
    }
  }
});

const getHistory = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'История диалога',
    position: [2900, 520],
    parameters: {
      resource: 'row',
      operation: 'get',
      dataTableId: msgsTable,
      matchType: 'allConditions',
      filters: { conditions: [{ keyName: 'user_id', condition: 'eq', keyValue: expr('{{ $json.user_id }}') }] },
      returnAll: false,
      limit: 20,
      orderBy: true,
      orderByColumn: 'createdAt',
      orderByDirection: 'DESC'
    }
  },
  output: [{ id: 5, user_id: '111', role: 'user', text: 'Привет', msg_id: '10', batch_done: false }]
});

const buildContext = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Контекст для ИИ',
    position: [3120, 520],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: `// Собираем для ИИ: данные лида + последние 20 сообщений в хронологическом порядке
const d = $('Склейка и решение').first().json;
const hist = $input.all().map(i => i.json).reverse();
const transcript = hist.map(m => (m.role === 'bot' ? 'Магазин: ' : 'Клиент: ') + (m.text || '')).join('\\n');
const prompt =
  'Данные клиента:\\n' +
  '- имя: ' + (d.name || 'не указано') + '\\n' +
  '- пришёл по рекламе товара: ' + (d.ad_ref || 'неизвестно') + '\\n' +
  '- текущий статус: ' + d.status + '\\n\\n' +
  'Переписка (последнее внизу):\\n' + transcript + '\\n\\n' +
  'Ответь на последние сообщения клиента.';
return [{ json: { ...d, prompt } }];`
    }
  },
  output: [{ user_id: '111', username: 'client', name: 'Малика', ad_ref: '', status: 'Новый', combined: 'Привет', prompt: 'Данные клиента...' }]
});

const geminiModel = languageModel({
  type: '@n8n/n8n-nodes-langchain.lmChatGoogleGemini',
  version: 1.2,
  config: {
    name: 'Gemini (бесплатный, тест)',
    position: [3340, 740],
    parameters: { modelName: 'models/gemini-3-flash-preview', options: { temperature: 0.4, maxOutputTokens: 1024 } },
    credentials: geminiCred
  }
});

const replyParser = outputParser({
  type: '@n8n/n8n-nodes-langchain.outputParserStructured',
  version: 1.3,
  config: {
    name: 'Формат ответа ИИ',
    position: [3500, 740],
    parameters: {
      schemaType: 'fromJson',
      jsonSchemaExample: '{ "reply": "Здравствуйте! Расскажу подробнее об альбоме.", "escalate": false, "escalate_reason": "", "status": "В диалоге", "summary": "Клиент интересуется альбомом, спрашивает о составе." }'
    }
  }
});

const aiSeller = node({
  type: '@n8n/n8n-nodes-langchain.chainLlm',
  version: 1.9,
  config: {
    name: 'ИИ-продавец',
    position: [3340, 520],
    onError: 'continueRegularOutput',
    parameters: {
      promptType: 'define',
      text: expr('{{ $json.prompt }}'),
      hasOutputParser: true,
      messages: {
        messageValues: [
          {
            type: 'SystemMessagePromptTemplate',
            message: 'Ты консультант интернет-магазина Yonda Cards в Ташкенте. Магазин продаёт готовые фотоальбомы. Ты пишешь клиенту в мессенджере от имени магазина: тепло, коротко, по делу, 1-4 предложения, можно 1-2 эмодзи (🤍 💌). Если клиент прямо спросит, бот ли ты, честно скажи, что ты помощник магазина и можешь позвать менеджера.\n\nЯЗЫК: отвечай на языке последнего сообщения клиента (русский или узбекский).\n\nТЕСТОВЫЙ РЕЖИМ: каталога с ценами и описаниями у тебя пока нет. НИКОГДА не придумывай цены, размеры, сроки, наличие и характеристики. Если клиент спрашивает о конкретном товаре или цене, вежливо скажи, что уточнишь у менеджера, и передай диалог менеджеру.\n\nОФОРМЛЕНИЕ ЗАКАЗА: когда клиент решил купить, попроси по очереди недостающее: номер телефона, удобное время получения, адрес доставки. Затем дай способы оплаты: Click https://indoor.click.uz/pay?id=0102906&t=0 или Payme https://transfer.paycom.uz/69f2022d050866cd0a35bac4 (также можно найти Yonda Cards в разделе Оплата на местах). Попроси прислать скриншот оплаты. Сообщи, что доставка оплачивается отдельно курьеру по тарифам Яндекс такси.\n\nНИКОГДА не подтверждай оплату сам. Когда клиент прислал скриншот оплаты (в переписке это строка с пометкой [photo]), поблагодари и передай менеджеру на проверку.\n\nПЕРЕДАЙ ДИАЛОГ МЕНЕДЖЕРУ (escalate = true), если: клиент просит человека или менеджера; жалоба или недовольство; просит скидку или торгуется; нестандартный заказ; вопрос о товаре или цене, на который у тебя нет данных; получен скриншот оплаты; ты не уверен, что ответить.\n\nПОЛЯ ОТВЕТА: reply — текст сообщения клиенту (без markdown и без HTML). escalate — передать ли менеджеру. escalate_reason — коротко почему (если escalate). status — один из: Новый, В диалоге, Выбрал товар, Ожидает оплаты, Ожидает проверки оплаты. summary — 1-2 предложения о сути диалога для менеджера.'
          }
        ]
      }
    },
    subnodes: { model: geminiModel, outputParser: replyParser }
  },
  output: [{ output: { reply: 'Здравствуйте!', escalate: false, escalate_reason: '', status: 'В диалоге', summary: 'Клиент поздоровался.' } }]
});

const parseAi = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Разбор ответа ИИ',
    position: [3560, 520],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: `// Проверяем ответ ИИ. Если ИИ упал или ответ пустой, передаём менеджеру, а не молчим.
const ctx = $('Контекст для ИИ').first().json;
const out = $input.first().json.output || null;
const esc = (t) => String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const allowed = ['Новый', 'В диалоге', 'Выбрал товар', 'Ожидает оплаты', 'Ожидает проверки оплаты'];
const ok = out && typeof out.reply === 'string' && out.reply.trim().length > 0;
const escalate = !ok || out.escalate === true;
let reason = '';
if (!ok) reason = 'ИИ не смог ответить';
else if (escalate) reason = out.escalate_reason || 'ИИ передал менеджеру';
const new_status = ok && allowed.includes(out.status) ? out.status : (ctx.status === 'Новый' ? 'В диалоге' : ctx.status);
return [{ json: {
  user_id: ctx.user_id,
  username: ctx.username,
  name: ctx.name,
  ad_ref: ctx.ad_ref,
  status: ctx.status,
  combined: ctx.combined,
  reply: ok ? esc(out.reply) : '',
  summary: ok ? (out.summary || '') : '',
  new_status,
  action: escalate ? 'escalate' : 'reply',
  reason
} }];`
    }
  },
  output: [{ user_id: '111', username: 'client', name: 'Малика', ad_ref: '', status: 'Новый', combined: 'Привет', reply: 'Здравствуйте!', summary: '', new_status: 'В диалоге', action: 'reply', reason: '' }]
});

const sendReply = node({
  type: 'n8n-nodes-base.telegram',
  version: 1.2,
  config: {
    name: 'Ответ клиенту',
    position: [4000, 420],
    parameters: {
      resource: 'message',
      operation: 'sendMessage',
      chatId: expr('{{ $json.user_id }}'),
      text: expr('{{ $json.reply }}'),
      replyMarkup: 'none',
      additionalFields: { appendAttribution: false, parse_mode: 'HTML' }
    },
    credentials: tgCred
  },
  output: [{ ok: true, result: { message_id: 12 } }]
});

const saveBotMsg = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Сохранить ответ бота',
    position: [4220, 420],
    parameters: {
      resource: 'row',
      operation: 'insert',
      dataTableId: msgsTable,
      columns: {
        mappingMode: 'defineBelow',
        value: {
          user_id: expr("{{ $('Разбор ответа ИИ').first().json.user_id }}"),
          channel: 'telegram',
          role: 'bot',
          text: expr("{{ $('Разбор ответа ИИ').first().json.reply }}"),
          msg_id: expr('{{ String($json.result?.message_id ?? "") }}'),
          batch_done: true
        },
        schema: [
          { id: 'user_id', displayName: 'user_id', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'channel', displayName: 'channel', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'role', displayName: 'role', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'text', displayName: 'text', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'msg_id', displayName: 'msg_id', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'batch_done', displayName: 'batch_done', required: false, defaultMatch: false, display: true, type: 'boolean', canBeUsedToMatch: true }
        ]
      }
    }
  },
  output: [{ id: 6 }]
});

const updateStatus = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Обновить статус лида',
    position: [4440, 420],
    parameters: {
      resource: 'row',
      operation: 'update',
      dataTableId: leadsTable,
      matchType: 'allConditions',
      filters: { conditions: [{ keyName: 'user_id', condition: 'eq', keyValue: expr("{{ $('Разбор ответа ИИ').first().json.user_id }}") }] },
      columns: {
        mappingMode: 'defineBelow',
        value: { status: expr("{{ $('Разбор ответа ИИ').first().json.new_status }}") },
        schema: [{ id: 'status', displayName: 'status', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }]
      }
    }
  },
  output: [{ id: 1 }]
});

const escData = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Данные эскалации',
    position: [4000, 760],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: `// Единые данные для эскалации: либо решение ИИ, либо голосовое сообщение (минуя ИИ)
let src = null;
try { src = $('Разбор ответа ИИ').first().json; } catch (e) { src = null; }
if (!src) {
  const s = $('Состояние лида').first().json;
  src = { user_id: s.user_id, username: s.username, name: s.name, ad_ref: s.lead_ad_ref, combined: '[голосовое сообщение]', reason: 'голосовое сообщение', summary: '' };
}
const esc = (t) => String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const link = src.username ? 'https://t.me/' + src.username : 'tg://user?id=' + src.user_id;
const text =
  '🟠 <b>Нужен менеджер</b>: ' + esc(src.reason) + '\\n' +
  '👤 ' + esc(src.name) + (src.username ? ' (@' + esc(src.username) + ')' : '') + '\\n' +
  '🔗 <a href="' + link + '">Открыть чат с клиентом</a>\\n' +
  '📣 Реклама: ' + esc(src.ad_ref || '—') + '\\n' +
  (src.summary ? '🧭 Суть: ' + esc(src.summary) + '\\n' : '') +
  '📝 Последнее: ' + esc(String(src.combined).slice(0, 500)) + '\\n\\n' +
  '<i>тест через Telegram</i>';
return [{ json: { ...src, group_text: text } }];`
    }
  },
  output: [{ user_id: '111', username: 'client', name: 'Малика', ad_ref: '', combined: 'позовите менеджера', reason: 'клиент просит менеджера', group_text: '🟠 Нужен менеджер' }]
});

const pauseLead = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Пауза бота на 24 ч',
    position: [4220, 760],
    parameters: {
      resource: 'row',
      operation: 'update',
      dataTableId: leadsTable,
      matchType: 'allConditions',
      filters: { conditions: [{ keyName: 'user_id', condition: 'eq', keyValue: expr('{{ $json.user_id }}') }] },
      columns: {
        mappingMode: 'defineBelow',
        value: {
          paused: true,
          paused_until: expr('{{ $now.plus(24, "hours").toISO() }}'),
          status: 'Нужен менеджер',
          escalation_reason: expr('{{ $json.reason }}')
        },
        schema: [
          { id: 'paused', displayName: 'paused', required: false, defaultMatch: false, display: true, type: 'boolean', canBeUsedToMatch: true },
          { id: 'paused_until', displayName: 'paused_until', required: false, defaultMatch: false, display: true, type: 'dateTime', canBeUsedToMatch: true },
          { id: 'status', displayName: 'status', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'escalation_reason', displayName: 'escalation_reason', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }
        ]
      }
    }
  },
  output: [{ id: 1 }]
});

const tellClient = node({
  type: 'n8n-nodes-base.telegram',
  version: 1.2,
  config: {
    name: 'Клиенту: передаём менеджеру',
    position: [4440, 760],
    parameters: {
      resource: 'message',
      operation: 'sendMessage',
      chatId: expr("{{ $('Данные эскалации').first().json.user_id }}"),
      text: 'Передаю ваш вопрос менеджеру 🤍 Он скоро свяжется с вами.',
      replyMarkup: 'none',
      additionalFields: { appendAttribution: false }
    },
    credentials: tgCred
  },
  output: [{ ok: true, result: { message_id: 13 } }]
});

const notifyManagers = node({
  type: 'n8n-nodes-base.telegram',
  version: 1.2,
  config: {
    name: 'Уведомить менеджеров',
    position: [4660, 760],
    parameters: {
      resource: 'message',
      operation: 'sendMessage',
      chatId: managersChatId,
      text: expr("{{ $('Данные эскалации').first().json.group_text }}"),
      replyMarkup: 'inlineKeyboard',
      inlineKeyboard: {
        rows: [
          { row: { buttons: [
            { text: '🙋 Взял в работу', additionalFields: { callback_data: expr("take:{{ $('Данные эскалации').first().json.user_id }}") } },
            { text: '🤖 Вернуть бота', additionalFields: { callback_data: expr("resume:{{ $('Данные эскалации').first().json.user_id }}") } }
          ] } }
        ]
      },
      additionalFields: { appendAttribution: false, parse_mode: 'HTML', disable_web_page_preview: true }
    },
    credentials: tgCred
  },
  output: [{ ok: true, result: { message_id: 14 } }]
});

const parseCb = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Разбор кнопки',
    position: [460, 100],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: `// Нажатие кнопки в группе менеджеров: take:<user_id> или resume:<user_id>
const cq = $input.first().json.callback_query;
const parts = String(cq.data || '').split(':');
const esc = (t) => String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const who = cq.from.username ? '@' + cq.from.username : (cq.from.first_name || 'менеджер');
return [{ json: {
  query_id: cq.id,
  act: parts[0],
  user_id: parts[1] || '',
  who,
  chat_id: String(cq.message.chat.id),
  message_id: String(cq.message.message_id),
  orig_html: esc(cq.message.text)
} }];`
    }
  },
  output: [{ query_id: 'q1', act: 'take', user_id: '111', who: '@manager', chat_id: '-5019520873', message_id: '14', orig_html: '🟠 Нужен менеджер' }]
});

const answerCb = node({
  type: 'n8n-nodes-base.telegram',
  version: 1.2,
  config: {
    name: 'Ответ на нажатие',
    position: [680, 100],
    parameters: {
      resource: 'callback',
      operation: 'answerQuery',
      queryId: expr('{{ $json.query_id }}'),
      additionalFields: { text: expr('{{ $json.act === "take" ? "Отмечено: вы взяли клиента" : "Бот снова отвечает клиенту" }}') }
    },
    credentials: tgCred
  },
  output: [{ ok: true, result: true }]
});

const routeButton = switchCase({
  version: 3.4,
  config: {
    name: 'Какая кнопка',
    position: [900, 100],
    parameters: {
      mode: 'rules',
      rules: {
        values: [
          { renameOutput: true, outputKey: 'Взял в работу', conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' }, conditions: [{ leftValue: expr("{{ $('Разбор кнопки').first().json.act }}"), operator: { type: 'string', operation: 'equals' }, rightValue: 'take' }], combinator: 'and' } },
          { renameOutput: true, outputKey: 'Вернуть бота', conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' }, conditions: [{ leftValue: expr("{{ $('Разбор кнопки').first().json.act }}"), operator: { type: 'string', operation: 'equals' }, rightValue: 'resume' }], combinator: 'and' } }
        ]
      },
      options: {}
    }
  }
});

const markTaken = node({
  type: 'n8n-nodes-base.telegram',
  version: 1.2,
  config: {
    name: 'Отметить «взял»',
    position: [1120, 0],
    parameters: {
      resource: 'message',
      operation: 'editMessageText',
      messageType: 'message',
      chatId: expr("{{ $('Разбор кнопки').first().json.chat_id }}"),
      messageId: expr("{{ $('Разбор кнопки').first().json.message_id }}"),
      text: expr("{{ $('Разбор кнопки').first().json.orig_html }}\n\n🙋 Взял: {{ $('Разбор кнопки').first().json.who }}"),
      replyMarkup: 'inlineKeyboard',
      inlineKeyboard: {
        rows: [
          { row: { buttons: [
            { text: '🤖 Вернуть бота', additionalFields: { callback_data: expr("resume:{{ $('Разбор кнопки').first().json.user_id }}") } }
          ] } }
        ]
      },
      additionalFields: { parse_mode: 'HTML', disable_web_page_preview: true }
    },
    credentials: tgCred
  },
  output: [{ ok: true }]
});

const unpauseLead = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Снять паузу',
    position: [1120, 200],
    parameters: {
      resource: 'row',
      operation: 'update',
      dataTableId: leadsTable,
      matchType: 'allConditions',
      filters: { conditions: [{ keyName: 'user_id', condition: 'eq', keyValue: expr("{{ $('Разбор кнопки').first().json.user_id }}") }] },
      columns: {
        mappingMode: 'defineBelow',
        value: { paused: false, status: 'В диалоге' },
        schema: [
          { id: 'paused', displayName: 'paused', required: false, defaultMatch: false, display: true, type: 'boolean', canBeUsedToMatch: true },
          { id: 'status', displayName: 'status', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }
        ]
      }
    }
  },
  output: [{ id: 1 }]
});

const markResumed = node({
  type: 'n8n-nodes-base.telegram',
  version: 1.2,
  config: {
    name: 'Отметить «бот вернулся»',
    position: [1340, 200],
    parameters: {
      resource: 'message',
      operation: 'editMessageText',
      messageType: 'message',
      chatId: expr("{{ $('Разбор кнопки').first().json.chat_id }}"),
      messageId: expr("{{ $('Разбор кнопки').first().json.message_id }}"),
      text: expr("{{ $('Разбор кнопки').first().json.orig_html }}\n\n🤖 Бот снова отвечает (вернул {{ $('Разбор кнопки').first().json.who }})"),
      replyMarkup: 'none',
      additionalFields: { parse_mode: 'HTML', disable_web_page_preview: true }
    },
    credentials: tgCred
  },
  output: [{ ok: true }]
});

const note = sticky('## Yonda — каркас бота (тест в Telegram)\nКлиент пишет боту в личку → склейка 15 с → ИИ-продавец (Gemini, тест) → ответ.\nГолосовое или решение ИИ (просьба менеджера, скидка, скриншот оплаты, нет данных) → пауза бота на 24 ч + уведомление в группу менеджеров с кнопками.\nРеклама: ссылка t.me/<бот>?start=ALB-001 сохраняет метку товара в лида.\nДанные: таблицы yonda_leads и yonda_messages.', [], { color: 4, position: [0, -260], width: 620, height: 220 });

export default workflow('yonda-tg-skeleton', 'Yonda Bot — каркас (Telegram)')
  .add(tgIn)
  .to(routeUpdate
    .onCase(0, parseCb.to(answerCb).to(routeButton
      .onCase(0, markTaken)
      .onCase(1, unpauseLead.to(markResumed))))
    .onCase(1, normalize.to(getLead).to(leadState).to(upsertLead).to(saveUserMsg).to(routeAction
      .onCase(0, escData.to(pauseLead).to(tellClient).to(notifyManagers))
      .onCase(1, greet)
      .onCase(2, waitDebounce.to(getLatest).to(isLatest
        .onTrue(getBatch.to(combine).to(getHistory).to(buildContext).to(aiSeller).to(parseAi).to(routeReply
          .onCase(0, sendReply.to(saveBotMsg).to(updateStatus))
          .onCase(1, escData))))))))
  .add(combine)
  .to(markDone)
  .add(note)
  .group('Кнопки менеджеров', [parseCb, answerCb, routeButton, markTaken, unpauseLead, markResumed], { description: 'Нажатия «Взял в работу» / «Вернуть бота» в группе менеджеров' })
  .group('Приём сообщения', [normalize, getLead, leadState, upsertLead, saveUserMsg], { description: 'Единый формат сообщения, состояние лида, запись в историю' })
  .group('Склейка 15 с', [waitDebounce, getLatest, isLatest, getBatch], { description: 'Ждём, пока клиент допишет, и берём все новые сообщения разом' })
  .group('ИИ-продавец', [combine, markDone, getHistory, buildContext, aiSeller, geminiModel, replyParser, parseAi], { description: 'История + Gemini: ответ клиенту, статус и решение о передаче менеджеру' })
  .group('Ответ клиенту', [sendReply, saveBotMsg, updateStatus], { description: 'Отправка ответа, запись в историю, обновление статуса лида' })
  .group('Эскалация', [escData, pauseLead, tellClient, notifyManagers], { description: 'Пауза бота на 24 ч и карточка клиента в группу менеджеров' });
