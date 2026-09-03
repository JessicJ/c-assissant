export function messagingHelpText(): string {
  return "Landi is connected. Talk naturally to view or change your Plan and to ask for current help. For example:\n• “What’s the weather now?”\n• “Where should we eat nearby?”\n• “Show me my current Plan”\n• “I want Italian food” — previews a Plan change before generating a replacement draft\n• “I prefer taxi” — updates the current route or Plan context\n\nControls:\n/plan — show the current Plan and confirmation control\n/prepare — prepare the current draft with connected sources and Skills\n/new <what you need to do> — create a separate complete Plan draft\n/profile — review or change your basic Profile\n/weather — check current weather for the Plan destination\n/food — find nearby food after an explicit location share\n/go — prepare a Movement Action Card for the next planned stop after an explicit location share\n/help — show this help\n\nLandi does not book, pay, order, call a ride, or start navigation.";
}

export function messagingStartText(trigger: "telegram" | "whatsapp"): string {
  return `This ${trigger === "whatsapp" ? "WhatsApp number" : "Telegram account"} is connected to Landi. Send /help to see available commands.`;
}

export function unknownCommandText(): string {
  return "That command is not available yet. Send /help to see what Landi can do.";
}

export function webWorkbenchPlanGenerationText(): string {
  return "Complete Trip Blueprint generation is currently available in the Web workbench. Landi will not use the older one-shot Plan generator or a local template fallback. Open Plan, start a planning conversation, confirm the proposal, and review the generated draft there.";
}
