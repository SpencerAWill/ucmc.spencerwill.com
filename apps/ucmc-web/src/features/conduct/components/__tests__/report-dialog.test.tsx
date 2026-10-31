import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  ReportDialog,
  UC_TITLE_IX_URL,
} from "#/features/conduct/components/report-dialog";

const submitFn = vi.hoisted(() => vi.fn(async () => ({ ok: true as const })));
vi.mock("#/features/conduct/server/report-fns", () => ({
  submitConductReportFn: submitFn,
  searchReportSubjectsFn: vi.fn(async () => []),
  listConductReportsFn: vi.fn(async () => []),
}));

function renderDialog() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <ReportDialog open onOpenChange={() => {}} />
    </QueryClientProvider>,
  );
}

describe("ReportDialog", () => {
  it("says the report carries the reporter's name and links to UC", () => {
    renderDialog();
    expect(screen.getByText(/with your name attached/)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "UC Title IX and reporting" }),
    ).toHaveAttribute("href", UC_TITLE_IX_URL);
    expect(
      screen.getByRole("link", { name: "UC anonymous reporting" }),
    ).toHaveAttribute("href", expect.stringContaining("ethicspoint.com"));
    expect(screen.getByText(/911/)).toBeInTheDocument();
  });

  it("swaps the picker for a description when the name is unknown", async () => {
    renderDialog();
    expect(screen.getByRole("combobox", { name: "Member" })).toBeVisible();
    await userEvent.click(screen.getByLabelText("I don't know their name"));
    expect(screen.queryByRole("combobox", { name: "Member" })).toBeNull();
    expect(
      screen.getByRole("textbox", { name: "Who is this about?" }),
    ).toBeVisible();
  });

  it("confirms after submitting, with no link", async () => {
    renderDialog();
    await userEvent.click(screen.getByLabelText("I don't know their name"));
    await userEvent.type(
      screen.getByRole("textbox", { name: "Who is this about?" }),
      "tall, red jacket",
    );
    await userEvent.type(
      screen.getByLabelText("When did it happen?"),
      "2026-10-01",
    );
    await userEvent.type(screen.getByLabelText("What happened?"), "Something");
    await userEvent.click(screen.getByRole("button", { name: "Send report" }));

    expect(
      await screen.findByText(
        /Thanks — the Executive Committee will review this/,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
    expect(submitFn).toHaveBeenCalledOnce();
  });
});
