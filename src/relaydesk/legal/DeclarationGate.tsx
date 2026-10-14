import { useRef, useState } from "react";
import { ScrollText } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  DECLARATION_ACCEPT,
  DECLARATION_CONFIRM_LABEL,
  DECLARATION_END,
  DECLARATION_INTRO,
  DECLARATION_SECTIONS,
  DECLARATION_TITLE,
} from "./declaration";

/** 使用与风险声明弹窗。
 *  - requireScroll：勾选框在正文滚动到底前禁用（注册/登录拦截路径）。
 *  - readOnly：关于页重读，无勾选区。 */
export function DeclarationGate({
  open,
  readOnly = false,
  requireScroll = false,
  onAccept,
  onClose,
}: {
  open: boolean;
  readOnly?: boolean;
  requireScroll?: boolean;
  onAccept?: () => void;
  onClose?: () => void;
}) {
  const [checked, setChecked] = useState(false);
  const [reachedEnd, setReachedEnd] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  function onScroll() {
    const el = bodyRef.current;
    if (!el || reachedEnd) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 8)
      setReachedEnd(true);
  }

  const checkboxDisabled = requireScroll && !reachedEnd;
  const canAccept = checked && !checkboxDisabled;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        // 只读弹窗允许点遮罩/ESC 关闭；强制阅读时锁死
        if (!o && readOnly && onClose) onClose();
      }}
    >
      <DialogContent
        className="rd-dialog rd-legal"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => {
          if (!readOnly) e.preventDefault();
        }}
      >
        <div className="rd-legal-head">
          <ScrollText
            size={22}
            aria-hidden
            style={{ color: "var(--rd-teal)" }}
          />
          <DialogTitle>{DECLARATION_TITLE}</DialogTitle>
          {readOnly && onClose && (
            <button
              type="button"
              className="rd-legal-close"
              onClick={onClose}
              aria-label="关闭"
            >
              ×
            </button>
          )}
        </div>
        <DialogDescription className="sr-only">
          {DECLARATION_TITLE}
        </DialogDescription>
        <div
          className="rd-legal-body"
          tabIndex={0}
          ref={bodyRef}
          onScroll={onScroll}
        >
          <p className="rd-legal-intro">{DECLARATION_INTRO}</p>
          {DECLARATION_SECTIONS.map((sec) => (
            <section key={sec.title}>
              <h2>{sec.title}</h2>
              {sec.blocks.map((parts, i) => (
                <p key={i}>
                  {parts.map((part, j) =>
                    part.b ? (
                      <strong key={j}>{part.t}</strong>
                    ) : (
                      <span key={j}>{part.t}</span>
                    ),
                  )}
                </p>
              ))}
            </section>
          ))}
          <p className="rd-legal-end">{DECLARATION_END}</p>
        </div>
        {readOnly ? null : (
          <div className="rd-legal-foot">
            {requireScroll && !reachedEnd && (
              <p className="rd-legal-scroll-hint" role="status">
                请先滚动阅读至声明底部
              </p>
            )}
            <label
              className={`rd-legal-confirm ${checkboxDisabled ? "is-disabled" : ""}`}
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={checkboxDisabled}
                onChange={(e) => setChecked(e.target.checked)}
                aria-label={DECLARATION_CONFIRM_LABEL}
              />
              <span>{DECLARATION_CONFIRM_LABEL}</span>
            </label>
            <button
              type="button"
              className="rd-button rd-primary"
              disabled={!canAccept}
              onClick={onAccept}
            >
              {DECLARATION_ACCEPT}
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
