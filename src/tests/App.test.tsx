import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { App } from "../App";

describe("App", () => {
  it("should render without crashing", async () => {
    render(<App />);
    
    // Should show loading state initially
    expect(screen.getByText(/Initializing/)).toBeInTheDocument();
    
    // Wait for initialization to complete
    await waitFor(() => {
      // After initialization (with mocked Tauri), should show MainLayout
      expect(screen.getByText(/BuzzAgent/)).toBeInTheDocument();
    }, { timeout: 5000 });
  }, 10000);
});
