/** Telegram source kind: configuration, receiving scope, policy, reply channel, chat-admin sync, and plugin entry. */
import type { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import { DEFAULT_TOKEN_ENV, TelegramApi, telegramToken } from './telegram-api.ts'
import { rememberTokenEnv, sendTelegram, telegramChannelLink } from './telegram-channel.ts'
import { runTelegram } from './telegram-loops.ts'
import { SOURCE, telegramTriggerId, type TelegramUser } from './telegram-trigger.ts'
import { sourceContext } from './host.ts'
import { rememberContextConfig, telegramThreadContext } from './telegram-context.ts'
import type { SourceContext, SourceHost, SourceKind } from './contract.ts'

/** Reads the Telegram instance's stored configuration; `host.sources.instance` is the host's own lookup. */
export const telegramSettings = (host: SourceHost): TelegramConfig => {
  const config = host.sources.instance<TelegramConfig>(SOURCE)?.config ?? TelegramConfigSchema.parse({})
  // Image reads receive no configuration of their own, so the installed settings are recorded here.
  rememberContextConfig(config)
  return config
}

export { SOURCE, mentionBot, messageText, placeholderFor, telegramTrigger, telegramTriggerId } from './telegram-trigger.ts'
export type { TelegramMessage, TelegramUser } from './telegram-trigger.ts'

const ChatSchema = z.object({
  chatId: z.string().regex(/^-?\d+$/),
  name: z.string().trim().max(60).optional(),
  listen: z.enum(['mentions', 'all']),
}).strict()
/** Stored configuration; every default receives nothing, so a fresh instance polls no chat. */
export const TelegramConfigSchema = z.object({
  tokenEnv: z.string().trim().min(1).default(DEFAULT_TOKEN_ENV),
  chats: z.array(ChatSchema)
    .refine(chats => new Set(chats.map(chat => chat.chatId)).size === chats.length, 'Duplicate chat IDs').default([]),
  directMessages: z.boolean().default(true),
  otherChats: z.enum(['none', 'mentions']).default('none'),
  editsAsNewEvents: z.boolean().default(false),
  channelPosts: z.boolean().default(false),
  pollTimeoutSeconds: z.number().int().min(0).max(50).default(25),
  failuresBeforeError: z.number().int().min(1).max(20).default(3),
  maxDownloadBytes: z.number().int().min(0).default(20 * 1024 * 1024),
  maxDownloadFiles: z.number().int().min(0).max(10).default(3),
}).strict()
export type TelegramConfig = z.infer<typeof TelegramConfigSchema>
const displayName = (user: TelegramUser): string =>
  [user.first_name, user.last_name].filter((part): part is string => !!part).join(' ') || user.username || String(user.id)
export const telegramKind: SourceKind<TelegramConfig> = {
  kind: SOURCE,
  title: { zh: 'Telegram', en: 'Telegram' },
  description: { zh: '接收下列群、频道和私聊中发给机器人的消息。', en: 'Receives messages to the bot in these groups, channels and direct chats.' },
  schema: TelegramConfigSchema,
  fields: [
    { key: 'tokenEnv', type: 'text', pattern: '[A-Za-z_][A-Za-z0-9_]*', label: { zh: '令牌环境变量', en: 'Token environment variable' },
      hint: { zh: '保存机器人令牌的环境变量名。令牌只从进程环境读取，不会写入设置或日志；改完后重启 dsh-superagent。', en: 'Name of the environment variable holding the bot token. The token is read from the process environment only and never stored in settings or logs; restart dsh-superagent after changing it.' } },
    { key: 'chats', type: 'rows', label: { zh: '接收的群和频道', en: 'Groups and channels' },
      hint: { zh: '“仅 @”只接收 @ 机器人的消息和已有工单的线程；“全部消息”也接收其余消息，评估可以按规则从中推断工作。频道帖子需要在下面单独打开。', en: '"@ only" receives messages that mention the bot and Threads that have Tickets; "All" also receives the rest, from which Eval may infer work under the rules. Channel posts are enabled separately below.' },
      columns: [
        { key: 'chatId', type: 'text', label: { zh: '聊天 ID', en: 'Chat ID' }, pattern: '-?\\d+', choose: { zh: '选择机器人已加入的聊天', en: 'Choose a chat the bot has joined' } },
        { key: 'name', type: 'text', label: { zh: '名字', en: 'Name' }, optional: true },
        { key: 'listen', type: 'select', label: { zh: '接收', en: 'Receive' }, options: [{ value: 'mentions', label: { zh: '仅 @', en: '@ only' } }, { value: 'all', label: { zh: '全部消息', en: 'All' } }] },
      ] },
    { key: 'otherChats', type: 'select', label: { zh: '其他群和频道', en: 'Other groups and channels' },
      options: [{ value: 'none', label: { zh: '不接收', en: 'Not received' } }, { value: 'mentions', label: { zh: '仅 @', en: '@ only' } }],
      hint: { zh: '机器人已加入、但没列在上面的群和频道。“仅 @”接收那里 @ 机器人的消息；谁的消息能发起工作看策略里的准入。', en: 'Groups and channels the bot has joined that are not listed above. "@ only" receives messages there that mention the bot; whose messages may originate work is the Policy\'s admission.' } },
    { key: 'directMessages', type: 'switch', label: { zh: '接收私聊', en: 'Direct messages' } },
    { key: 'channelPosts', type: 'switch', label: { zh: '接收频道帖子', en: 'Channel posts' },
      hint: { zh: '机器人是频道管理员时，接收频道里发布的帖子。', en: 'Receive posts published in channels where the bot is an administrator.' } },
    { key: 'editsAsNewEvents', type: 'switch', advanced: true, label: { zh: '把编辑当作新消息', en: 'Treat edits as new messages' },
      hint: { zh: '打开后，编辑过的消息会以新的触发再次评估；关闭时忽略编辑。', en: 'When on, an edited message is assessed again under a new Trigger; when off, edits are ignored.' } },
    { key: 'pollTimeoutSeconds', type: 'number', advanced: true, min: 0, max: 50, label: { zh: '长轮询等待 / 秒', en: 'Long-poll timeout / seconds' },
      hint: { zh: 'getUpdates 每次最多等待的时间；0 表示立即返回。', en: 'How long each getUpdates call may wait; 0 returns immediately.' } },
    { key: 'failuresBeforeError', type: 'number', advanced: true, min: 1, max: 20, label: { zh: '连续失败几次后报告异常', en: 'Failed polls before reporting an error' },
      hint: { zh: '单次网络中断会在下一次轮询时自动重试，不必报告。', en: 'A single network interruption is retried on the next poll and need not be reported.' } },
    { key: 'maxDownloadBytes', type: 'number', advanced: true, min: 0, max: 20 * 1024 * 1024, label: { zh: '单个文件下载上限 / 字节', en: 'Download limit per file / bytes' },
      hint: { zh: '机器人接口本身最多允许 20 MB；设为 0 关闭媒体下载，消息里只保留文件名占位。', en: 'The Bot API itself allows at most 20 MB; 0 turns media downloads off and leaves only the file-name placeholder in the message.' } },
    { key: 'maxDownloadFiles', type: 'number', advanced: true, min: 0, max: 10, label: { zh: '每条消息最多下载几个文件', en: 'Downloads per message' },
      hint: { zh: '一条消息带多个文件时，只下载前几个，其余只留占位。', en: 'When a message carries several files, only the first ones are downloaded and the rest stay as placeholders.' } },
  ],
  health: ['telegram'],
  // Reads the chat around a Trigger and turns one image of it into an attachment during assessment.
  threadContext: telegramThreadContext as unknown as SourceKind<TelegramConfig>['threadContext'],
  scope({ meta }, config) {
    if (meta.direct === true) {
      return config.directMessages ? { listened: true, observed: false, row: 'direct' }
        : { listened: false, reason: 'direct_messages_not_allowed' }
    }
    const chat = config.chats.find(item => item.chatId === meta.chatId)
    if (chat) return { listened: true, observed: chat.listen === 'all', row: chat.chatId }
    return config.otherChats === 'mentions' ? { listened: true, observed: false, row: 'other' }
      : { listened: false, reason: 'chat_not_listened' }
  },
  // A reply goes only to a chat the Source still receives.
  channel: {
    allowed: (address, config) => {
      rememberTokenEnv(config.tokenEnv)
      return telegramKind.scope!({ meta: { chatId: address.chatId ?? '', direct: address.direct === 'true' } }, config).listened
    },
    send: sendTelegram, link: telegramChannelLink,
  },
  // A message's Trigger is named after the message, so the one it answers is named after its parent.
  repliesTo: trigger => {
    const chatId = typeof trigger.meta.chatId === 'string' ? trigger.meta.chatId : ''
    const parentId = typeof trigger.meta.replyToId === 'string' ? trigger.meta.replyToId : ''
    return chatId && parentId ? telegramTriggerId(chatId, parentId) : undefined
  },
  policy: {
    unnamed: { person: { zh: 'Telegram 用户', en: 'Telegram user' }, bot: { zh: 'Telegram 机器人', en: 'Telegram bot' } },
    schema: z.object({
      allowed: z.array(z.object({ id: z.string().regex(/^\d+$/), name: z.string().trim().max(100).optional() }).strict())
        .refine(users => new Set(users.map(user => user.id)).size === users.length, 'Duplicate user IDs').default([]),
      syncChat: z.string().regex(/^(-?\d+)?$/).default(''),
    }).strict(),
    fields: [
      { key: 'allowed', type: 'rows', label: { zh: '能发起工作的 Telegram 用户', en: 'Telegram users who may originate work' },
        columns: [{ key: 'id', type: 'text', label: { zh: '用户 ID', en: 'User ID' }, pattern: '\\d+' }, { key: 'name', type: 'text', label: { zh: '名字', en: 'Name' }, optional: true }] },
      { key: 'syncChat', type: 'text', pattern: '(-?\\d+)?', label: { zh: '同步来源群', en: 'Sync chat' }, choose: { zh: '不同步', en: 'Do not sync' },
        hint: { zh: '同步时，名单变成这个群的管理员：新管理员加入，离开的人移除，名字取 Telegram 上的名字。启动时和点同步时进行。', en: 'Syncing makes the list the administrators of this chat: new administrators join, people who left are removed, and names follow Telegram. It runs at startup and on Sync.' } },
    ],
    explicit: { zh: '名单内的人 @ 机器人或私聊机器人，总是明确的请求，不需要配置。', en: 'Someone on the list who mentions the bot or messages it directly always makes an explicit request; that needs no setting.' },
    rows(stored) {
      const config = TelegramConfigSchema.parse(stored)
      const mentions = { zh: '仅 @', en: '@ only' }
      return [
        ...config.chats.map(chat => ({ id: chat.chatId, label: chat.name || chat.chatId,
          note: chat.listen === 'all' ? { zh: '全部消息', en: 'All' } : mentions,
          cells: { listedUnaddressed: chat.listen === 'all', unlistedAddressed: true, unlistedUnaddressed: chat.listen === 'all' } })),
        { id: 'other', label: { zh: '其他群和频道', en: 'Other groups and channels' },
          note: config.otherChats === 'mentions' ? mentions : { zh: '不接收', en: 'Not received' },
          cells: { listedUnaddressed: false, unlistedAddressed: config.otherChats === 'mentions', unlistedUnaddressed: false } },
        { id: 'direct', label: { zh: '私聊', en: 'Direct messages' },
          note: config.directMessages ? { zh: '接收', en: 'Received' } : { zh: '不接收', en: 'Not received' },
          cells: { listedUnaddressed: false, unlistedAddressed: config.directMessages, unlistedUnaddressed: false } },
      ]
    },
    sync: {
      label: { zh: '立即同步', en: 'Sync now' },
      ready: (part: { syncChat: string; allowed: { id: string; name?: string }[] }) => !!part.syncChat,
      async run(host: SourceHost, part: { syncChat: string; allowed: { id: string; name?: string }[] }, signal: AbortSignal) {
        if (!part.syncChat) return part
        const members = await new TelegramApi(telegramToken(telegramSettings(host).tokenEnv))
          .getChatAdministrators(String(part.syncChat), signal)
        // A bot can be an administrator too, but only people may originate work.
        const administrators = new Map(members.filter(member => member.user && !member.user.is_bot
          && (member.status === 'administrator' || member.status === 'creator')).map(member => [String(member.user.id), member.user]))
        const known = new Set(part.allowed.map(entry => entry.id))
        return { ...part, allowed: [
          ...part.allowed.filter(entry => administrators.has(entry.id))
            .map(entry => ({ ...entry, name: displayName(administrators.get(entry.id)!) })),
          ...[...administrators].filter(([id]) => !known.has(id)).map(([id, user]) => ({ id, name: displayName(user) })),
        ] }
      },
    },
  },
  environment: {
    variables: [
      { key: 'DSH_SUPERAGENT_TELEGRAM_CHAT', description: { zh: '接下工单的 Telegram 聊天 ID；工单不是从 Telegram 来的时为空', en: 'Chat ID of the Telegram chat that started the ticket; empty when the ticket did not start on Telegram' } },
      { key: 'DSH_SUPERAGENT_TELEGRAM_THREAD', description: { zh: '接下工单的话题 ID；没有话题时为空', en: 'Topic ID of the Telegram chat that started the ticket; empty when it has no topic' } },
    ],
    values: ({ trigger }) => ({
      DSH_SUPERAGENT_TELEGRAM_CHAT: trigger?.source === SOURCE ? String(trigger.meta.chatId ?? '') : '',
      DSH_SUPERAGENT_TELEGRAM_THREAD: trigger?.source === SOURCE ? String(trigger.meta.messageThreadId ?? '') : '',
    }),
  },
}
