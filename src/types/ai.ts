export type ConversationMessage = {
  role: "user" | "assistant";
  content: string;
};

export type BotReplyResult = {
  text: string;
  toolSummary: string;
};