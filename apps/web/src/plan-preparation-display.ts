import type { Task } from "@c-assistant/core";

export type PreparationDisplayItem = { task: Task; stageTitle: string };

export function groupPreparationItems(items: PreparationDisplayItem[]): Array<{ title: string; items: PreparationDisplayItem[] }> {
  const groups = new Map<string, PreparationDisplayItem[]>();
  const order = ["Packing", "Documents", "Phone and payments", "Bookings and departure", "Other tasks"];
  for (const item of items) {
    const explicitGroup = item.task.preparationCategory === "packing_item" ? "Packing"
      : item.task.preparationCategory === "documents" ? "Documents"
        : item.task.preparationCategory === "digital" ? "Phone and payments"
          : item.task.preparationCategory === "booking" ? "Bookings and departure"
            : item.task.preparationCategory === "other_predeparture" ? "Other tasks" : undefined;
    const titleText = item.task.title.toLocaleLowerCase();
    const title = explicitGroup ?? (/passport|visa|insurance|document|permit|certificate|admission letter/.test(titleText) ? "Documents"
      : /app|sim|esim|phone setup|internet|payment|cash|bank card|network/.test(titleText) ? "Phone and payments"
        : /book|booking|confirm|flight|hotel|accommodation|lodging|reservation|ticket|departure/.test(titleText) ? "Bookings and departure"
          : /sunscreen|sun cream|sunblock|hat|swimsuit|swimwear|umbrella|raincoat|jacket|shirt|trousers|shorts|dress|shoes|sandals|medicine|medication|charger|cable|adapter|power bank|toiletr|glasses|mask|bottle/.test(titleText) ? "Packing" : "Other tasks");
    groups.set(title, [...(groups.get(title) ?? []), item]);
  }
  return order.filter((title) => groups.has(title)).map((title) => ({ title, items: groups.get(title)! }));
}

export function isExplicitPreparationTask(task: Pick<Task, "owner" | "preparationCategory">): boolean {
  return task.owner === "user" && task.preparationCategory !== undefined && task.preparationCategory !== "not_applicable";
}
