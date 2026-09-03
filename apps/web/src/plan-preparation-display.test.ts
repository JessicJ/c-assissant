import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Task } from "@c-assistant/core";
import { groupPreparationItems, isExplicitPreparationTask } from "./plan-preparation-display.js";

function task(title: string, patch: Partial<Task> = {}): Task {
  return {
    id: title,
    title,
    owner: "user",
    status: "waiting_user",
    dueLabel: "Before departure",
    ...patch
  } as Task;
}

describe("plan preparation display helpers", () => {
  it("prefers explicit preparation categories and keeps group order stable", () => {
    const groups = groupPreparationItems([
      { task: task("Install payment app", { preparationCategory: "digital" }), stageTitle: "Prep" },
      { task: task("Pack passport", { preparationCategory: "packing_item" }), stageTitle: "Prep" },
      { task: task("Confirm hotel", { preparationCategory: "booking" }), stageTitle: "Prep" }
    ]);

    assert.deepEqual(groups.map((group) => group.title), ["Packing", "Phone and payments", "Bookings and departure"]);
  });

  it("falls back to title-based grouping when explicit categories are absent", () => {
    assert.equal(groupPreparationItems([{ task: task("Download offline map app"), stageTitle: "Prep" }])[0]?.title, "Phone and payments");
  });

  it("marks only user-owned explicit preparation tasks as checkable", () => {
    assert.equal(isExplicitPreparationTask(task("Passport", { preparationCategory: "documents" })), true);
    assert.equal(isExplicitPreparationTask(task("Review route", { preparationCategory: "not_applicable" })), false);
    assert.equal(isExplicitPreparationTask(task("External booking", { owner: "external", preparationCategory: "booking" })), false);
  });
});
