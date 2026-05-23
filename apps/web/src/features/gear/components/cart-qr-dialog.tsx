import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";

import { Button } from "#/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog";
import { mintCartTokenFn } from "#/features/gear/server/gear-fns";

interface CartQrDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Modal that mints a fresh `ucmc-cart:<uuid>` token from the member's
 * cart and renders it as a QR code for the officer to scan at the
 * gear desk.
 *
 * Token freshness: every time the dialog opens we call
 * `mintCartTokenFn` directly. A re-open mints a new token rather than
 * reusing the previous one — cheap insurance against a photographed
 * QR being replayed off-camera after the member has left the cave.
 *
 * `useMutation` would add no value here (no cache to invalidate, no
 * pending state we'd surface anywhere else), so we call the server fn
 * directly per the project rule banning inline `useMutation` only in
 * routes/components that ALSO need cache invalidation.
 */
export function CartQrDialog({ open, onOpenChange }: CartQrDialogProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Mint on open; clear on close so the next open is always fresh.
  useEffect(() => {
    if (!open) {
      setToken(null);
      setExpiresAt(null);
      setErrorMessage(null);
      return;
    }
    let cancelled = false;
    mintCartTokenFn()
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) {
          setErrorMessage(
            "Your cart is empty — add some gear before generating a QR code.",
          );
          return;
        }
        setToken(result.token);
        setExpiresAt(result.expiresAt);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setErrorMessage(
          err instanceof Error && err.message
            ? err.message
            : "Couldn't generate a QR code. Try again.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Render to canvas when the token is ready and the canvas is mounted.
  useEffect(() => {
    if (!token || !canvasRef.current) return;
    void QRCode.toCanvas(canvasRef.current, token, {
      width: 320,
      margin: 1,
      errorCorrectionLevel: "M",
    });
  }, [token]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Show this at the gear desk</DialogTitle>
          <DialogDescription>
            The cave manager scans this code to pre-fill the checkout with your
            cart. The code expires in a few minutes — open this again if it
            does.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-3 py-2">
          {errorMessage ? (
            <p className="text-sm text-destructive">{errorMessage}</p>
          ) : token ? (
            <>
              <canvas
                ref={canvasRef}
                aria-label="Gear cart QR code"
                className="rounded-md bg-white p-3"
              />
              {expiresAt !== null ? (
                <p className="text-xs text-muted-foreground">
                  Expires at{" "}
                  {new Date(expiresAt).toLocaleTimeString([], {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Generating QR code…</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
