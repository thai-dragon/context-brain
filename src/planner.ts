import { getSupabase } from "./supabase";

export interface TaskUpdate {
  action: "add" | "complete" | "remove";
  date: string; // YYYY-MM-DD
  project: string;
  task: string;
  points?: number;
}

interface DailyTask {
  id: number;
  date: string;
  project: string;
  task: string;
  done: boolean;
  points: number;
}

// Unicode strikethrough — works in plain text mode in Telegram
function strikethrough(text: string): string {
  return text.split("").map((c) => c + "\u0336").join("");
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function tomorrow(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function resolveDate(dateStr: string): string {
  if (dateStr === "today") return today();
  if (dateStr === "tomorrow") return tomorrow();
  return dateStr; // already YYYY-MM-DD
}

export async function addTask(
  date: string,
  project: string,
  task: string,
  points = 1
) {
  await getSupabase().from("daily_tasks").insert({
    date: resolveDate(date),
    project: project.toUpperCase(),
    task,
    points,
  });
}

export async function completeTask(date: string, project: string, task: string) {
  const d = resolveDate(date);

  // Try with project + task match
  const { data: exact } = await getSupabase()
    .from("daily_tasks")
    .select("id")
    .eq("date", d)
    .eq("project", project.toUpperCase())
    .ilike("task", `%${task}%`)
    .eq("done", false)
    .limit(1);

  if (exact && exact.length > 0) {
    await getSupabase().from("daily_tasks").update({ done: true }).eq("id", exact[0].id);
    return true;
  }

  // Fallback: search across all projects for that date
  const { data: fuzzy } = await getSupabase()
    .from("daily_tasks")
    .select("id")
    .eq("date", d)
    .ilike("task", `%${task}%`)
    .eq("done", false)
    .limit(1);

  if (fuzzy && fuzzy.length > 0) {
    await getSupabase().from("daily_tasks").update({ done: true }).eq("id", fuzzy[0].id);
    return true;
  }

  return false;
}

export async function removeTask(date: string, project: string, task: string) {
  const d = resolveDate(date);

  // "all" or "*" removes everything for that date
  if (task === "all" || task === "*" || project === "ALL") {
    await getSupabase()
      .from("daily_tasks")
      .delete()
      .eq("date", d);
    return;
  }

  const p = project.toUpperCase();
  await getSupabase()
    .from("daily_tasks")
    .delete()
    .eq("date", d)
    .eq("project", p)
    .ilike("task", `%${task}%`);
}

export async function applyTaskUpdates(updates: TaskUpdate[]) {
  for (const u of updates) {
    switch (u.action) {
      case "add":
        await addTask(u.date, u.project, u.task, u.points ?? 1);
        break;
      case "complete":
        await completeTask(u.date, u.project, u.task);
        break;
      case "remove":
        await removeTask(u.date, u.project, u.task);
        break;
    }
  }
}

export async function getRecentDoneTasks(days = 14): Promise<DailyTask[]> {
  const from = new Date();
  from.setDate(from.getDate() - days);
  const fromStr = from.toISOString().slice(0, 10);

  const { data } = await getSupabase()
    .from("daily_tasks")
    .select("*")
    .gte("date", fromStr)
    .eq("done", true)
    .order("date", { ascending: false })
    .order("project");
  return (data as DailyTask[]) ?? [];
}

export async function getTasksForDate(date: string): Promise<DailyTask[]> {
  const d = resolveDate(date);
  const { data } = await getSupabase()
    .from("daily_tasks")
    .select("*")
    .eq("date", d)
    .order("project")
    .order("created_at");
  return (data as DailyTask[]) ?? [];
}

export function formatTasks(tasks: DailyTask[], date: string): string {
  if (tasks.length === 0) return `Нет задач на ${date}`;

  // Group by project
  const groups: Record<string, DailyTask[]> = {};
  for (const t of tasks) {
    if (!groups[t.project]) groups[t.project] = [];
    groups[t.project].push(t);
  }

  let totalPoints = 0;
  let donePoints = 0;
  const lines: string[] = [];

  lines.push(`${date}\n`);

  for (const [project, projectTasks] of Object.entries(groups)) {
    const projectTotal = projectTasks.reduce((s, t) => s + t.points, 0);
    const projectDone = projectTasks
      .filter((t) => t.done)
      .reduce((s, t) => s + t.points, 0);
    totalPoints += projectTotal;
    donePoints += projectDone;

    lines.push(`${project} (${projectDone}/${projectTotal} pts):`);
    for (const t of projectTasks) {
      const taskText = t.done ? `  ${strikethrough(t.task)}` : `  ${t.task}`;
      lines.push(taskText);
    }
    lines.push("");
  }

  lines.push(`Progress: ${donePoints}/${totalPoints} pts`);
  return lines.join("\n");
}

export function formatSummary(tasks: DailyTask[], date: string): string {
  if (tasks.length === 0) return `Нет данных за ${date}`;

  const groups: Record<string, DailyTask[]> = {};
  for (const t of tasks) {
    if (!groups[t.project]) groups[t.project] = [];
    groups[t.project].push(t);
  }

  let totalPoints = 0;
  let donePoints = 0;
  const lines: string[] = [];

  lines.push(`Summary ${date}\n`);

  for (const [project, projectTasks] of Object.entries(groups)) {
    const projectTotal = projectTasks.reduce((s, t) => s + t.points, 0);
    const projectDone = projectTasks
      .filter((t) => t.done)
      .reduce((s, t) => s + t.points, 0);
    totalPoints += projectTotal;
    donePoints += projectDone;

    const status = projectDone === projectTotal ? "done" : `${projectDone}/${projectTotal}`;
    lines.push(`${project}: ${status}`);
  }

  const pct = totalPoints > 0 ? Math.round((donePoints / totalPoints) * 100) : 0;
  lines.push(`\nTotal: ${donePoints}/${totalPoints} pts (${pct}%)`);
  return lines.join("\n");
}
