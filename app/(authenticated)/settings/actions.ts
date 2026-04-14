"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/server";
import { getCurrentUserOrNull } from "@/lib/supabase/server-auth";
import { DASHBOARD_FOCUS_METRIC_OPTIONS, type DashboardFocusMetricKey } from "@/lib/data/dashboard";

function redirectWithMessage(message: string, kind: "success" | "error") {
  const params = new URLSearchParams({ message, kind });
  redirect(`/settings?${params.toString()}`);
}

function readText(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function readNumber(formData: FormData, key: string, fallback: number) {
  const value = String(formData.get(key) ?? "").trim();
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseFloat(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readInteger(formData: FormData, key: string, fallback: number) {
  return Math.trunc(readNumber(formData, key, fallback));
}

function readBoolean(formData: FormData, key: string) {
  return formData.get(key) === "on";
}

function readStringArray(formData: FormData, key: string) {
  return formData
    .getAll(key)
    .map((value) => String(value).trim())
    .filter((value) => value.length > 0);
}

function readFocusMetricKeys(formData: FormData, key: string): DashboardFocusMetricKey[] {
  return readStringArray(formData, key).filter((value): value is DashboardFocusMetricKey =>
    DASHBOARD_FOCUS_METRIC_OPTIONS.some((option) => option.key === value),
  );
}

function revalidateViews() {
  revalidatePath("/");
  revalidatePath("/reports");
  revalidatePath("/settings");
  revalidatePath("/dashboard");
}

export async function createMechanicAction(formData: FormData) {
  const user = await getCurrentUserOrNull();
  if (!user) {
    redirect("/login?redirect=/settings");
  }

  const mechanicName = readText(formData, "mechanic_name");
  const mechanicItemNo = readText(formData, "mechanic_item_no");
  const displayOrder = readInteger(formData, "display_order", 0);
  const active = readBoolean(formData, "active");

  if (!mechanicName || !mechanicItemNo) {
    redirectWithMessage("Udfyld navn og varenummer.", "error");
  }

  const supabase = createAdminClient();
  const { error } = await supabase.from("mechanic_item_mapping").insert({
    mechanic_name: mechanicName,
    mechanic_item_no: mechanicItemNo,
    display_order: displayOrder,
    active,
  });

  if (error) {
    redirectWithMessage(error.message, "error");
  }

  revalidateViews();
  redirectWithMessage("Mekaniker oprettet.", "success");
}

export async function saveSettingsAction(formData: FormData) {
  const user = await getCurrentUserOrNull();
  if (!user) {
    redirect("/login?redirect=/settings");
  }

  const ids = formData.getAll("id").map((value) => String(value));
  const mechanicNames = formData.getAll("mechanic_name").map((value) => String(value).trim());
  const mechanicItemNos = formData.getAll("mechanic_item_no").map((value) => String(value).trim());
  const displayOrders = formData.getAll("display_order").map((value) => {
    const parsed = Number.parseInt(String(value), 10);
    return Number.isFinite(parsed) ? parsed : 0;
  });
  const activeIds = new Set(formData.getAll("active_ids").map((value) => String(value)));

  const boardTypes = formData.getAll("board_type").map((value) => String(value));
  const boardTitles = formData.getAll("board_title").map((value) => String(value));
  const durations = formData.getAll("duration_seconds").map((value) => {
    const parsed = Number.parseInt(String(value), 10);
    return Number.isFinite(parsed) ? Math.max(5, parsed) : 20;
  });
  const dashboardDisplayOrders = formData.getAll("dashboard_display_order").map((value) => {
    const parsed = Number.parseInt(String(value), 10);
    return Number.isFinite(parsed) ? parsed : 0;
  });
  const activeBoardTypes = new Set(formData.getAll("active_board_types").map((value) => String(value)));

  const newMechanicName = readText(formData, "new_mechanic_name");
  const newMechanicItemNo = readText(formData, "new_mechanic_item_no");
  const newDisplayOrder = readInteger(formData, "new_display_order", 0);
  const newActive = readBoolean(formData, "new_active");

  if (ids.length > 0 && (ids.length !== mechanicNames.length || ids.length !== mechanicItemNos.length || ids.length !== displayOrders.length)) {
    redirectWithMessage("Mekanikerlisten kunne ikke gemmes.", "error");
  }

  if (
    boardTypes.length === 0 ||
    boardTypes.length !== boardTitles.length ||
    boardTypes.length !== durations.length ||
    boardTypes.length !== dashboardDisplayOrders.length
  ) {
    redirectWithMessage("Dashboard-indstillingerne kunne ikke gemmes.", "error");
  }

  if ((newMechanicName && !newMechanicItemNo) || (!newMechanicName && newMechanicItemNo)) {
    redirectWithMessage("Udfyld både navn og varenummer for ny mekaniker, eller lad begge felter være tomme.", "error");
  }

  const supabase = createAdminClient();
  const now = new Date().toISOString();

  if (ids.length > 0) {
    const mechanicUpdates = ids.map((id, index) => ({
      id,
      mechanic_name: mechanicNames[index],
      mechanic_item_no: mechanicItemNos[index],
      display_order: displayOrders[index],
      active: activeIds.has(id),
      updated_at: now,
    }));

    if (mechanicUpdates.some((row) => !row.id || !row.mechanic_name || !row.mechanic_item_no)) {
      redirectWithMessage("Alle mekanikere skal have navn og varenummer.", "error");
    }

    const { error } = await supabase.from("mechanic_item_mapping").upsert(mechanicUpdates, { onConflict: "id" });

    if (error) {
      redirectWithMessage(error.message, "error");
    }
  }

  if (newMechanicName && newMechanicItemNo) {
    const { error } = await supabase.from("mechanic_item_mapping").insert({
      mechanic_name: newMechanicName,
      mechanic_item_no: newMechanicItemNo,
      display_order: newDisplayOrder,
      active: newActive,
    });

    if (error) {
      redirectWithMessage(error.message, "error");
    }
  }

  const dashboardUpdates = boardTypes.map((boardType, index) => ({
    board_type: boardType,
    board_title: boardTitles[index],
    duration_seconds: durations[index],
    display_order: dashboardDisplayOrders[index],
    active: activeBoardTypes.has(boardType),
    selected_mechanic_ids: formData.getAll(`selected_mechanic_ids_${boardType}`).map((value) => String(value)),
    selected_focus_metric_keys: readFocusMetricKeys(formData, `selected_focus_metric_keys_${boardType}`),
    updated_at: now,
  }));

  const invalidFocusSelection = dashboardUpdates.find(
    (update) =>
      update.board_type === "mechanic_focus" &&
      (update.selected_focus_metric_keys.length < 2 || update.selected_focus_metric_keys.length > 3),
  );

  if (invalidFocusSelection) {
    redirectWithMessage("Mekaniker-fokus skal vise mindst 2 og højst 3 værdier.", "error");
  }

  const { error: dashboardError } = await supabase.from("dashboard_view_settings").upsert(dashboardUpdates, {
    onConflict: "board_type",
  });

  if (dashboardError) {
    redirectWithMessage(dashboardError.message, "error");
  }

  revalidateViews();
  redirectWithMessage("Indstillinger gemt.", "success");
}

export async function updateMechanicAction(formData: FormData) {
  const user = await getCurrentUserOrNull();
  if (!user) {
    redirect("/login?redirect=/settings");
  }

  const id = readText(formData, "id");
  const mechanicName = readText(formData, "mechanic_name");
  const mechanicItemNo = readText(formData, "mechanic_item_no");
  const dailyTargetHours = readNumber(formData, "daily_target_hours", 8);
  const displayOrder = readInteger(formData, "display_order", 0);
  const active = readBoolean(formData, "active");

  if (!id || !mechanicName || !mechanicItemNo) {
    redirectWithMessage("Mekaniker kunne ikke gemmes.", "error");
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("mechanic_item_mapping")
    .update({
      mechanic_name: mechanicName,
      mechanic_item_no: mechanicItemNo,
      daily_target_hours: dailyTargetHours,
      display_order: displayOrder,
      active,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) {
    redirectWithMessage(error.message, "error");
  }

  revalidateViews();
  redirectWithMessage("Mekaniker gemt.", "success");
}

export async function bulkUpdateMechanicsAction(formData: FormData) {
  const user = await getCurrentUserOrNull();
  if (!user) {
    redirect("/login?redirect=/settings");
  }

  const ids = formData.getAll("id").map((value) => String(value));
  const mechanicNames = formData.getAll("mechanic_name").map((value) => String(value).trim());
  const mechanicItemNos = formData.getAll("mechanic_item_no").map((value) => String(value).trim());
  const dailyTargetHours = formData.getAll("daily_target_hours").map((value) => {
    const parsed = Number.parseFloat(String(value).replace(",", "."));
    return Number.isFinite(parsed) ? parsed : 8;
  });
  const displayOrders = formData.getAll("display_order").map((value) => {
    const parsed = Number.parseInt(String(value), 10);
    return Number.isFinite(parsed) ? parsed : 0;
  });
  const activeIds = new Set(formData.getAll("active_ids").map((value) => String(value)));

  if (
    ids.length === 0 ||
    ids.length !== mechanicNames.length ||
    ids.length !== mechanicItemNos.length ||
    ids.length !== dailyTargetHours.length ||
    ids.length !== displayOrders.length
  ) {
    redirectWithMessage("Mekanikerlisten kunne ikke gemmes.", "error");
  }

  const updates = ids.map((id, index) => ({
    id,
    mechanic_name: mechanicNames[index],
    mechanic_item_no: mechanicItemNos[index],
    daily_target_hours: dailyTargetHours[index],
    display_order: displayOrders[index],
    active: activeIds.has(id),
    updated_at: new Date().toISOString(),
  }));

  if (updates.some((row) => !row.id || !row.mechanic_name || !row.mechanic_item_no)) {
    redirectWithMessage("Alle mekanikere skal have navn og varenummer.", "error");
  }

  const supabase = createAdminClient();
  const { error } = await supabase.from("mechanic_item_mapping").upsert(updates, { onConflict: "id" });

  if (error) {
    redirectWithMessage(error.message, "error");
  }

  revalidateViews();
  redirectWithMessage("Mekanikerændringer gemt.", "success");
}

export async function updateDashboardViewSettingAction(formData: FormData) {
  const user = await getCurrentUserOrNull();
  if (!user) {
    redirect("/login?redirect=/settings");
  }

  const boardType = readText(formData, "board_type");
  const displayOrder = readInteger(formData, "display_order", 0);
  const durationSeconds = Math.max(5, readInteger(formData, "duration_seconds", 20));
  const active = readBoolean(formData, "active");
  const selectedMechanicIds = readStringArray(formData, "selected_mechanic_ids");

  if (!boardType) {
    redirectWithMessage("Dashboard-indstilling kunne ikke gemmes.", "error");
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("dashboard_view_settings")
    .update({
      display_order: displayOrder,
      duration_seconds: durationSeconds,
      active,
      selected_mechanic_ids: selectedMechanicIds,
      updated_at: new Date().toISOString(),
    })
    .eq("board_type", boardType);

  if (error) {
    redirectWithMessage(error.message, "error");
  }

  revalidateViews();
  redirectWithMessage("Dashboard-indstilling gemt.", "success");
}

export async function saveRevenueTargetsAction(formData: FormData) {
  const user = await getCurrentUserOrNull();
  if (!user) {
    redirect("/login?redirect=/settings");
  }

  const arbeidstid = readNumber(formData, "revenue_target_arbeidstid", 0);
  const repair = readNumber(formData, "revenue_target_repair", 0);
  const cykelplus = readNumber(formData, "revenue_target_cykelplus", 0);
  const hourlyRate = readNumber(formData, "revenue_target_hourly_rate", 450);

  const now = new Date().toISOString();
  const supabase = createAdminClient();

  const { error } = await supabase.from("revenue_kpi_targets").upsert(
    [
      { metric_key: "arbeidstid", daily_target: arbeidstid, updated_at: now },
      { metric_key: "repair", daily_target: repair, updated_at: now },
      { metric_key: "cykelplus", daily_target: cykelplus, updated_at: now },
      { metric_key: "hourly_rate", daily_target: hourlyRate, updated_at: now },
    ],
    { onConflict: "metric_key" },
  );

  if (error) {
    redirectWithMessage(error.message, "error");
  }

  revalidateViews();
  redirectWithMessage("Omsætningsmål gemt.", "success");
}

export async function bulkUpdateDashboardViewSettingsAction(formData: FormData) {
  const user = await getCurrentUserOrNull();
  if (!user) {
    redirect("/login?redirect=/settings");
  }

  const boardTypes = formData.getAll("board_type").map((value) => String(value));
  const boardTitles = formData.getAll("board_title").map((value) => String(value));
  const durations = formData.getAll("duration_seconds").map((value) => {
    const parsed = Number.parseInt(String(value), 10);
    return Number.isFinite(parsed) ? Math.max(5, parsed) : 20;
  });
  const displayOrders = formData.getAll("display_order").map((value) => {
    const parsed = Number.parseInt(String(value), 10);
    return Number.isFinite(parsed) ? parsed : 0;
  });
  const activeBoardTypes = new Set(formData.getAll("active_board_types").map((value) => String(value)));

  if (
    boardTypes.length === 0 ||
    boardTypes.length !== boardTitles.length ||
    boardTypes.length !== durations.length ||
    boardTypes.length !== displayOrders.length
  ) {
    redirectWithMessage("Dashboard-indstillingerne kunne ikke gemmes.", "error");
  }

  const now = new Date().toISOString();
  const updates = boardTypes.map((boardType, index) => ({
    board_type: boardType,
    board_title: boardTitles[index],
    duration_seconds: durations[index],
    display_order: displayOrders[index],
    active: activeBoardTypes.has(boardType),
    selected_mechanic_ids: formData.getAll(`selected_mechanic_ids_${boardType}`).map((value) => String(value)),
    selected_focus_metric_keys: readFocusMetricKeys(formData, `selected_focus_metric_keys_${boardType}`),
    updated_at: now,
  }));

  const invalidFocusSelection = updates.find(
    (update) =>
      update.board_type === "mechanic_focus" &&
      (update.selected_focus_metric_keys.length < 2 || update.selected_focus_metric_keys.length > 3),
  );

  if (invalidFocusSelection) {
    redirectWithMessage("Mekaniker-fokus skal vise mindst 2 og højst 3 værdier.", "error");
  }

  const supabase = createAdminClient();
  const { error } = await supabase.from("dashboard_view_settings").upsert(updates, { onConflict: "board_type" });

  if (error) {
    redirectWithMessage(error.message, "error");
  }

  revalidateViews();
  redirectWithMessage("Dashboard-indstillinger gemt.", "success");
}
