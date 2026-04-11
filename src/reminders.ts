import { getSupabase } from "./supabase";

export interface ReminderUpdate {
  date: string; // YYYY-MM-DD
  message: string;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function addReminder(date: string, message: string) {
  await getSupabase().from("reminders").insert({ date, message });
}

export async function applyReminderUpdates(updates: ReminderUpdate[]) {
  for (const u of updates) {
    await addReminder(u.date, u.message);
  }
}

export async function checkReminders(): Promise<string[]> {
  const { data } = await getSupabase()
    .from("reminders")
    .select("id, message")
    .eq("date", today())
    .eq("sent", false);

  if (!data || data.length === 0) return [];

  const messages = data.map((r) => r.message);

  // Mark as sent
  const ids = data.map((r) => r.id);
  await getSupabase()
    .from("reminders")
    .update({ sent: true })
    .in("id", ids);

  return messages;
}
