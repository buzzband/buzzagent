import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { InputBar } from "../components/Chat/InputBar";

describe("InputBar", () => {
  it("renders input field and send button", () => {
    render(
      <InputBar
        value=""
        onChange={() => {}}
        onSubmit={() => {}}
        disabled={false}
      />
    );
    expect(screen.getByPlaceholderText("Ask BuzzAgent...")).toBeInTheDocument();
  });

  it("disables button when input is empty", () => {
    render(
      <InputBar
        value=""
        onChange={() => {}}
        onSubmit={() => {}}
        disabled={false}
      />
    );
    const button = screen.getByTitle("Send message (Enter)");
    expect(button).toBeDisabled();
  });

  it("disables button when disabled prop is true", () => {
    render(
      <InputBar
        value="test"
        onChange={() => {}}
        onSubmit={() => {}}
        disabled={true}
      />
    );
    const button = screen.getByTitle("Agent is running...");
    expect(button).toBeDisabled();
  });
});
