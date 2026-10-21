const WEEKS = [
  // ── Week 1 ──
  [
    { type: 'question', question: "are your oranges from china", answer: "i saw a black eagle", conversationPrompt: "what's your name and what does it mean" },
    { type: 'activity', instruction: "Find someone wearing the same colour as you. Give them a compliment and ask their name." },
    { type: 'question', question: "does the moon pay rent", answer: "only in dimes", conversationPrompt: "what brought you here tonight" },
    { type: 'activity', instruction: "Turn to the person next to you. Trade one thing you love about Black Labone, then shake hands." },
  ],
  // ── Week 2 ──
  [
    { type: 'question', question: "can fish lie", answer: "yes but only on thursdays", conversationPrompt: "tell me something good that happened to you this week" },
    { type: 'activity', instruction: "Find someone you haven't met yet. Introduce yourself and share one thing you're passionate about." },
    { type: 'question', question: "is your left shoe jealous", answer: "it started the rumor", conversationPrompt: "what's the best thing you've discovered lately" },
    { type: 'activity', instruction: "Form a group of three. Each person shares a highlight from their week. Cheer the best one together." },
  ],
  // ── Week 3 ──
  [
    { type: 'question', question: "who taught the wind to whistle", answer: "a goat from pretoria", conversationPrompt: "tell me about your first Black Labone" },
    { type: 'activity', instruction: "Link arms with two people and form a circle. Say your name and one word that describes your week." },
    { type: 'question', question: "do stairs get tired", answer: "that's why they have railings", conversationPrompt: "what does this place feel like to you" },
    { type: 'activity', instruction: "Give someone a spontaneous high-five and tell them you're glad they showed up tonight." },
  ],
  // ── Week 4 ──
  [
    { type: 'question', question: "why do eggs exist", answer: "the hen lost a bet", conversationPrompt: "what's a small thing that made you smile today" },
    { type: 'activity', instruction: "Stand back to back with someone. Count to three, turn around, and say the first thing that comes to mind." },
    { type: 'question', question: "is your shadow watching us", answer: "it's holding a fork", conversationPrompt: "what's your favourite thing about being here" },
    { type: 'activity', instruction: "Pair up and teach each other a simple hand clap pattern. Keep it going together." },
  ],
  // ── Week 5 ──
  [
    { type: 'question', question: "can you return a Tuesday", answer: "i tried. store credit only.", conversationPrompt: "what does community mean to you" },
    { type: 'activity', instruction: "Find three people. Create a group pose together and name your group." },
    { type: 'question', question: "does the bassist know", answer: "the bassist always knows", conversationPrompt: "what song do you want to hear tonight" },
    { type: 'activity', instruction: "Link pinkies with a stranger and ask them: what does community mean to you?" },
  ],
  // ── Week 6 ──
  [
    { type: 'question', question: "when did numbers get so loud", answer: "around 2016. seven started it.", conversationPrompt: "what's one word for how you're feeling right now" },
    { type: 'activity', instruction: "Find someone who looks lost in thought. Ask them what they're thinking about." },
    { type: 'question', question: "do you trust the ceiling", answer: "it's covering something up", conversationPrompt: "who in this room would you like to know better" },
    { type: 'activity', instruction: "Form a line of three people. Take turns giving each other a nickname for the night." },
  ],
  // ── Week 7 ──
  [
    { type: 'question', question: "is tonight a dream", answer: "check your pockets for stairs", conversationPrompt: "what does showing up mean to you" },
    { type: 'activity', instruction: "Find someone wearing black shoes. Ask them where they'd travel if they could leave tonight." },
    { type: 'question', question: "who chose the font", answer: "a pigeon in sunglasses", conversationPrompt: "what's something you've never told anyone here" },
    { type: 'activity', instruction: "Group of four. Each person shares a song that represents their mood. Hum a bit of it together." },
  ],
  // ── Week 8 ──
  [
    { type: 'question', question: "does your phone miss you", answer: "it's seeing other chargers", conversationPrompt: "what's the last thing that made you laugh out loud" },
    { type: 'activity', instruction: "Find two people and create a quick handshake routine. Perform it together." },
    { type: 'question', question: "is the floor listening", answer: "it's been holding everything in", conversationPrompt: "what's something you want to leave behind this year" },
    { type: 'activity', instruction: "Synchronise three deep breaths with someone next to you. Then introduce yourselves." },
  ],
  // ── Week 9 ──
  [
    { type: 'question', question: "can a whisper travel backwards", answer: "only if the room owes it money", conversationPrompt: "what's a sound you love" },
    { type: 'activity', instruction: "Find someone standing alone. Stand with them for a moment in comfortable silence, then ask their name." },
    { type: 'question', question: "do streetlights gossip", answer: "that's why they flicker", conversationPrompt: "what does belonging feel like to you" },
    { type: 'activity', instruction: "Form a circle of five. Each person says one word to describe the room right now." },
  ],
  // ── Week 10 ──
  [
    { type: 'question', question: "does your reflection trust you", answer: "it's been watching", conversationPrompt: "what's something you see in yourself that you're proud of" },
    { type: 'activity', instruction: "Pair up. Face each other and mirror each other's movements for 10 seconds without laughing." },
    { type: 'question', question: "do swallows dream of flying", answer: "they dream of luggage", conversationPrompt: "what's a small risk you took that paid off" },
    { type: 'activity', instruction: "Find someone with the same shoe size as you. Compare stories about your favourite pair of shoes." },
  ],
  // ── Week 11 ──
  [
    { type: 'question', question: "is the encore ever enough", answer: "the stage knows the truth", conversationPrompt: "what moment tonight will you remember tomorrow" },
    { type: 'activity', instruction: "Gather three people and invent a secret handshake for the group. Use it when you see each other later." },
    { type: 'question', question: "does the dark have a favourite colour", answer: "it's partial to violet", conversationPrompt: "what does creativity mean to you" },
    { type: 'activity', instruction: "Find someone you haven't spoken to. Ask them: what's one thing you hope happens before the night ends." },
  ],
  // ── Week 12 ──
  [
    { type: 'question', question: "can you hear the room breathe", answer: "listen. in between the beats.", conversationPrompt: "what made you choose to be here tonight" },
    { type: 'activity', instruction: "Form a small circle. Each person says their name and does a gesture. The group repeats it back." },
    { type: 'question', question: "does the last song know", answer: "it's been practicing all day", conversationPrompt: "what's one word for what this place gives you" },
    { type: 'activity', instruction: "Find a partner. Count down from three and both say the first word that comes to mind. If it matches, celebrate." },
  ],
]

export function getWeekItems(weekIndex) {
  return WEEKS[weekIndex % WEEKS.length]
}
