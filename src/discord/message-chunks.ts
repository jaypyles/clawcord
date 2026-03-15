const MAX_DISCORD_MESSAGE_LENGTH = 2000;

export function splitIntoDiscordMessages(input: string): string[] {
  if (input.length <= MAX_DISCORD_MESSAGE_LENGTH) {
    return [input];
  }

  const chunks: string[] = [];
  let remaining = input;

  while (remaining.length > MAX_DISCORD_MESSAGE_LENGTH) {
    const window = remaining.slice(0, MAX_DISCORD_MESSAGE_LENGTH);
    const splitAtNewline = window.lastIndexOf("\n");
    const splitAtSpace = window.lastIndexOf(" ");
    const splitIndex =
      splitAtNewline > 0
        ? splitAtNewline
        : splitAtSpace > 0
          ? splitAtSpace
          : MAX_DISCORD_MESSAGE_LENGTH;

    chunks.push(remaining.slice(0, splitIndex).trimEnd());
    remaining = remaining.slice(splitIndex).trimStart();
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks.length > 0 ? chunks : [input];
}
