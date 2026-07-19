// Shared emoji groups for the composer's picker and the message reaction
// picker's expanded (chevron) mode, so both stay in sync from one list.
export const EMOJI_GROUPS = [
  {
    label: "Частые",
    emojis: ["😂", "❤️", "👍", "🔥", "🥹", "😍", "🙏", "🎉", "💯", "✨", "👏", "🤝"],
  },
  {
    label: "Эмоции",
    emojis: [
      "😀", "😁", "🤣", "😊", "😘", "😎", "🤔", "🙄", "😴", "😭", "😡", "🥳",
      "😅", "😉", "🥰", "😱", "😬", "🤯", "😇", "🤗", "🤤", "😋", "😜", "🤪",
      "😏", "😶", "🫡", "🤐", "🥶", "🤒", "🤧", "🫠", "💀",
    ],
  },
  {
    label: "Жесты",
    emojis: ["👍", "👎", "👏", "🙏", "💪", "🤝", "✌️", "🤞", "👌", "🫶", "👋", "🙌", "🤙", "👇", "👆"],
  },
  {
    label: "Символы",
    emojis: ["❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "💔", "💋", "💕", "⭐", "🌟", "✅", "❌"],
  },
  {
    label: "Разное",
    emojis: ["👀", "🧠", "🫀", "🍕", "☕", "🍺", "🎁", "💰", "📎"],
  },
] as const;
