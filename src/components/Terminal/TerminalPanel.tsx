import React, { useEffect, useRef, useState } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import { invoke } from "../../services/ipc";

/**
 * Interactive-ish terminal: input is executed via the backend `shell_exec`
 * command (in the project directory). Output and prompt are rendered in
 * xterm.js. Enter runs, Ctrl+C cancels the current input line.
 */
export function TerminalPanel() {
  const terminalRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const lineBufferRef = useRef<string[]>([]);
  const historyRef = useRef<string[]>([]);
  const historyPosRef = useRef<number>(-1);
  const busyRef = useRef(false);
  const [hasBackend, setHasBackend] = useState(true);

  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      theme: {
        background: "#1e1e1e",
        foreground: "#d4d4d4",
        cursor: "#569cd6",
        black: "#1e1e1e",
        red: "#f44747",
        green: "#4ec9b0",
        yellow: "#ce9178",
        blue: "#569cd6",
        magenta: "#c586c0",
        cyan: "#9cdcfe",
        white: "#d4d4d4",
        brightBlack: "#3a3a3a",
        brightRed: "#f44747",
        brightGreen: "#4ec9b0",
        brightYellow: "#ce9178",
        brightBlue: "#569cd6",
        brightMagenta: "#c586c0",
        brightCyan: "#9cdcfe",
        brightWhite: "#d4d4d4",
      },
      fontFamily: "monospace",
      fontSize: 14,
      lineHeight: 1.4,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);
    fitAddon.fit();

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    const prompt = () => term.write("\r\n\x1b[36m$\x1b[0m ");

    term.writeln("BuzzAgent Terminal — commands run in the project directory");
    prompt();

    term.onData(async (data) => {
      const term2 = termRef.current;
      if (!term2 || busyRef.current) return;

      if (data === "\r") {
        const command = lineBufferRef.current.join("");
        lineBufferRef.current = [];
        term2.write("\r\n");
        if (command.trim()) {
          historyRef.current.push(command);
          historyPosRef.current = -1;
          busyRef.current = true;
          try {
            const result = await invoke<{ stdout: string; stderr: string; code: number | null }>(
              "shell_exec",
              { command }
            );
            if (result.stdout) term2.write(result.stdout.replace(/\n/g, "\r\n"));
            if (result.stderr) {
              term2.write(`\x1b[31m${result.stderr.replace(/\n/g, "\r\n")}\x1b[0m`);
            }
            if (result.code !== null && result.code !== 0) {
              term2.write(`\r\n\x1b[90mexit code: ${result.code}\x1b[0m`);
            }
          } catch (err) {
            term2.write(`\x1b[31m${String(err)}\x1b[0m`);
            setHasBackend(false);
          } finally {
            busyRef.current = false;
          }
        }
        prompt();
      } else if (data === "\u007f") {
        // Backspace
        if (lineBufferRef.current.length > 0) {
          lineBufferRef.current.pop();
          term2.write("\b \b");
        }
      } else if (data === "\u0003") {
        // Ctrl+C — clear current line
        lineBufferRef.current = [];
        term2.write("^C");
        prompt();
      } else if (data >= " ") {
        lineBufferRef.current.push(data);
        term2.write(data);
      }
    });

    const handleResize = () => fitAddon.fit();
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      term.dispose();
    };
  }, []);

  return (
    <div className="terminal-panel">
      <div className="terminal-toolbar">
        <span>Terminal</span>
        <div className="terminal-actions">
          <button onClick={() => termRef.current?.reset()} title="Clear">
            🧹
          </button>
        </div>
      </div>
      {!hasBackend && (
        <div className="terminal-warning">
          Backend unavailable — terminal requires the desktop runtime.
        </div>
      )}
      <div ref={terminalRef} className="terminal-container" />
    </div>
  );
}
