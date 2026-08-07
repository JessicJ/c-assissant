import type { ImmigrationStatus, Profile, ProfileGender, ProfileUpdate } from "@c-assistant/core";
import type { TelegramProfileTextField } from "@c-assistant/storage";

export type TelegramProfileCallback =
  | { type: "edit_text"; field: TelegramProfileTextField }
  | { type: "choose"; field: "gender" | "immigrationStatus" }
  | { type: "set_gender"; value: ProfileGender }
  | { type: "set_immigration_status"; value: ImmigrationStatus }
  | { type: "unknown" };

export type TelegramInlineMarkup = { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };

const genderLabels: Record<ProfileGender, string> = {
  not_specified: "Not specified",
  woman: "Woman",
  man: "Man",
  nonbinary: "Nonbinary",
  prefer_not_to_say: "Prefer not to say"
};

const immigrationLabels: Record<ImmigrationStatus, string> = {
  unknown: "Not sure yet",
  short_term_visitor: "Short-term visitor",
  tourist_visa: "Tourist visa",
  student_visa: "Student visa",
  work_visa: "Work visa",
  residence_permit: "Residence permit",
  other: "Other"
};

export function formatTelegramProfile(profile: Profile): string {
  const readiness = profile.status === "ready" ? "Basic policy-routing facts are recorded." : "You can keep using Plans now and complete missing basics later.";
  return `Your Profile\nName: ${profile.displayName}\nPreferred language: ${profile.preferredLanguage}\nNationality: ${profile.nationality}\nGender: ${genderLabels[profile.gender]}\nChina visa / residence status: ${immigrationLabels[profile.immigrationStatus]}\nStatus: ${profile.status}\n\n${readiness}\nThese are long-term settings. Dates, companions, accommodation, and precise location stay inside each Plan.`;
}

export function telegramProfileMarkup(): TelegramInlineMarkup {
  return { inline_keyboard: [
    [{ text: "Name", callback_data: "profile_edit:displayName" }, { text: "Language", callback_data: "profile_edit:preferredLanguage" }],
    [{ text: "Nationality", callback_data: "profile_edit:nationality" }],
    [{ text: "Gender", callback_data: "profile_choose:gender" }, { text: "China status", callback_data: "profile_choose:immigrationStatus" }]
  ] };
}

export function telegramProfileChoiceMarkup(field: "gender" | "immigrationStatus"): TelegramInlineMarkup {
  if (field === "gender") {
    return { inline_keyboard: (Object.entries(genderLabels) as Array<[ProfileGender, string]>).map(([value, label]) => [{ text: label, callback_data: `profile_set:gender:${value}` }]) };
  }
  return { inline_keyboard: (Object.entries(immigrationLabels) as Array<[ImmigrationStatus, string]>).map(([value, label]) => [{ text: label, callback_data: `profile_set:immigrationStatus:${value}` }]) };
}

export function parseTelegramProfileCallback(value: string | undefined): TelegramProfileCallback {
  const textField = value?.match(/^profile_edit:(displayName|preferredLanguage|nationality)$/)?.[1] as TelegramProfileTextField | undefined;
  if (textField) return { type: "edit_text", field: textField };
  const choice = value?.match(/^profile_choose:(gender|immigrationStatus)$/)?.[1] as "gender" | "immigrationStatus" | undefined;
  if (choice) return { type: "choose", field: choice };
  const gender = value?.match(/^profile_set:gender:(not_specified|woman|man|nonbinary|prefer_not_to_say)$/)?.[1] as ProfileGender | undefined;
  if (gender) return { type: "set_gender", value: gender };
  const immigrationStatus = value?.match(/^profile_set:immigrationStatus:(unknown|short_term_visitor|tourist_visa|student_visa|work_visa|residence_permit|other)$/)?.[1] as ImmigrationStatus | undefined;
  if (immigrationStatus) return { type: "set_immigration_status", value: immigrationStatus };
  return { type: "unknown" };
}

export function telegramProfileTextPrompt(field: TelegramProfileTextField): string {
  const label = field === "displayName" ? "name" : field === "preferredLanguage" ? "preferred language" : "nationality";
  return `Send the ${label} you want saved as your next message. Keep it under ${field === "nationality" ? 100 : 80} characters. This request expires in 15 minutes; commands are never consumed as Profile values.`;
}

export function updateProfileText(profile: Profile, field: TelegramProfileTextField, value: string): ProfileUpdate {
  const normalized = value.replaceAll(/\s+/g, " ").trim();
  return { ...profile, [field]: normalized };
}
