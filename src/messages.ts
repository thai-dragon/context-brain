import { getSupabase } from "./supabase";

export interface Message {
  id: number;
  created_at: string;
  date: string;
  role: "user" | "assistant";
  text: string;
}

export async function saveMessage(role: "user" | "assistant", text: string) {
  const date = new Date().toISOString().slice(0, 10);
  await getSupabase().from("messages").insert({ date, role, text });
}

export async function getMessagesForDate(date: string): Promise<Message[]> {
  const { data } = await getSupabase()
    .from("messages")
    .select("*")
    .eq("date", date)
    .order("created_at", { ascending: true });
  return (data as Message[]) ?? [];
}
