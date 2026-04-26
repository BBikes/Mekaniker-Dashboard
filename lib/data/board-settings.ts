import { createAdminClient } from "@/lib/supabase/server";

export type BoardType = "today" | "yesterday" | "current_week" | "current_month";

export type BoardSetting = {
  board_type: BoardType;
  active: boolean;
  label: string;
  sort_order: number;
};

const DEFAULTS: BoardSetting[] = [
  { board_type: "today",         active: false, label: "I dag",        sort_order: 1 },
  { board_type: "yesterday",     active: true,  label: "I går",        sort_order: 2 },
  { board_type: "current_week",  active: true,  label: "Aktuel uge",   sort_order: 3 },
  { board_type: "current_month", active: true,  label: "Aktuel måned", sort_order: 4 },
];

export async function getBoardSettings(): Promise<BoardSetting[]> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("board_settings")
    .select("board_type, active, label, sort_order")
    .order("sort_order");

  if (error || !data || data.length === 0) {
    // Table may not exist yet — return defaults
    return DEFAULTS;
  }

  return data as BoardSetting[];
}

export async function upsertBoardSettings(settings: BoardSetting[]): Promise<void> {
  const db = createAdminClient();
  const { error } = await db
    .from("board_settings")
    .upsert(settings, { onConflict: "board_type" });

  if (error) throw new Error(`Failed to save board settings: ${error.message}`);
}
