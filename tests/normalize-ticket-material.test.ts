import { describe, expect, it } from "vitest";

import { normalizeTicketMaterial } from "@/lib/c1st/normalize-ticket-material";

describe("normalizeTicketMaterial", () => {
  it("normalizes the documented task material fields", () => {
    const normalized = normalizeTicketMaterial({
      id: 91,
      taskid: 123,
      title: "Mechanic work",
      amount: 8,
      paymentid: 77,
      amountpaid: "12.50",
      updated_at: "2026-04-04T08:20:00Z",
      product: {
        productno: "MEK-ALICE",
      },
    });

    expect(normalized).toMatchObject({
      ticketMaterialId: 91,
      ticketId: 123,
      productNo: "MEK-ALICE",
      amount: 8,
      paymentId: 77,
      amountPaid: 12.5,
    });
  });

  it("supports amount fallback to quantity and direct product number", () => {
    const normalized = normalizeTicketMaterial({
      id: "4",
      ticketid: "9981",
      quantity: "3",
      productno: 3456,
    });

    expect(normalized).toMatchObject({
      ticketMaterialId: 4,
      ticketId: 9981,
      productNo: "3456",
      amount: 3,
    });
  });
});
