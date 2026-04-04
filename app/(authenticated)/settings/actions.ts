"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/server";
import { getCurrentUserOrNull } from "@/lib/supabase/server-auth";

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
  const dailyTargetHours = readNumber(formData, "daily_target_hours", 8);
  const displayOrder = readInteger(formData, "display_order", 0);
  const active = readBoolean(formData, "active");

  if (!mechanicName || !mechanicItemNo) {
    redirectWithMessage("Udfyld navn og varenummer.", "error");
  }

  const supabase = createAdminClient();
  const { error } = await supabase.from("mechanic_item_mapping").insert({
    mechanic_name: mechanicName,
    mechanic_item_no: mechanicItemNo,
    daily_target_hours: dailyTargetHours,
    display_order: displayOrder,
    active,
  });

  if (error) {
    redirectWithMessage(error.message, "error");
  }

  revalidateViews();
  redirectWithMessage("Mekaniker oprettet.", "success");
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
