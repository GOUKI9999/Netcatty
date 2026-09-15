import type { Terminal as XTerm } from "@xterm/xterm";
import type React from "react";
import { useEffect } from "react";

import { requestMultilinePasteConfirm } from "../../../application/state/multilinePasteConfirmStore";
import { netcattyBridge } from "../../../infrastructure/services/netcattyBridge";
import { logger } from "../../../lib/logger";
import type { TerminalSession } from "../../../types";
import type { RemoteClipboardImageUploadResult } from "../clipboardImagePaste";
import type { MultilinePasteConfirmGate } from "../terminalClipboardPaste";
import { handleTerminalClipboardPaste } from "../terminalClipboardPaste";

interface UseTerminalFilePasteOptions {
  isLocalConnection: boolean;
  status: TerminalSession["status"];
  termRef: React.MutableRefObject<XTerm | null>;
  sessionRef: React.MutableRefObject<string | null>;
  terminalBackend: {
    writeToSession: (sessionId: string, data: string, options?: { automated?: boolean; sensitive?: boolean }) => void;
  };
  isSensitiveInput?: () => boolean;
  scrollOnPasteRef?: React.RefObject<boolean>;
  onPasteData?: (data: string) => boolean | void;
  scrollToBottomAfterProgrammaticInput: (data: string) => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Remote sessions only: auto-upload a clipboard image on paste. */
  autoUploadClipboardImage?: boolean;
  /** Multi-line paste confirmation gate (#3398); undefined keeps confirm off. */
  multilinePasteConfirmRef?: React.RefObject<Omit<MultilinePasteConfirmGate, "requestConfirm"> | undefined>;
  getRemoteCwd?: () => Promise<string | null | undefined>;
  onClipboardImageUploadResult?: (result: RemoteClipboardImageUploadResult) => void;
}

export function useTerminalFilePaste({
  isLocalConnection,
  status,
  termRef,
  sessionRef,
  terminalBackend,
  isSensitiveInput,
  scrollOnPasteRef,
  onPasteData,
  scrollToBottomAfterProgrammaticInput,
  containerRef,
  autoUploadClipboardImage = false,
  multilinePasteConfirmRef,
  getRemoteCwd,
  onClipboardImageUploadResult,
}: UseTerminalFilePasteOptions) {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handlePaste = (event: ClipboardEvent) => {
      if (status !== "connected") return;

      const bridge = netcattyBridge.get();

      const wantsImageUpload =
        autoUploadClipboardImage && !isLocalConnection && !!bridge?.readClipboardImage;
      const canHandleLocalPaste =
        isLocalConnection && !!(bridge?.readClipboardFiles || bridge?.hasClipboardImage);
      if (!wantsImageUpload && !canHandleLocalPaste) return;

      // ⚡ Must call preventDefault SYNCHRONOUSLY — the event lifecycle
      // is synchronous; calling it after an await is too late and the
      // browser will have already performed the default paste action.
      event.preventDefault();
      event.stopPropagation();

      void (async () => {
        try {
          const term = termRef.current;
          if (!term) return;
          await handleTerminalClipboardPaste({
            bridge,
            autoUploadClipboardImage: wantsImageUpload,
            clipboardImageBridge: bridge ?? undefined,
            confirmMultilinePaste: multilinePasteConfirmRef?.current
              ? { ...multilinePasteConfirmRef.current, requestConfirm: requestMultilinePasteConfirm }
              : undefined,
            getRemoteCwd,
            isLocalConnection,
            isSensitiveInput,
            onClipboardImageUploadResult,
            readClipboardText: () => navigator.clipboard.readText(),
            scrollOnPaste: scrollOnPasteRef?.current ?? false,
            onPasteData,
            sessionId: sessionRef.current,
            terminalBackend,
            term,
            scrollToBottomAfterProgrammaticInput,
          });
        } catch (error) {
          logger.error("Failed to handle file paste", error);
        }
      })();
    };

    container.addEventListener("paste", handlePaste, true);
    return () => {
      container.removeEventListener("paste", handlePaste, true);
    };
  }, [
    autoUploadClipboardImage,
    containerRef,
    multilinePasteConfirmRef,
    getRemoteCwd,
    isLocalConnection,
    isSensitiveInput,
    onClipboardImageUploadResult,
    onPasteData,
    scrollOnPasteRef,
    scrollToBottomAfterProgrammaticInput,
    sessionRef,
    status,
    terminalBackend,
    termRef,
  ]);
}
