import { useState } from "react";
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
  DECLARATION_VERSION,
} from "./declaration";

/** 首次使用强制阅读门：完整声明 + 勾选同意 + 继续。
 *  readOnly 时作为关于页的只读重读弹窗。 */
export function DeclarationGate({
  open,
  readOnly = false,
  onAccept,
  onClose,
}: {
  open: boolean;
  readOnly?: boolean;
  onAccept?: () => void;
  onClose?: () => void;
}) {
  const [checked, setChecked] = useState(false);
  return (
    <Dialog open={open}>
      <DialogContent
        className="rd-dialog rd-legal"
        // 未勾选前不允许点击遮罩/ESC 跳过——强制路径
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <div className="rd-legal-head">
          <ScrollText
            size={22}
            aria-hidden
            style={{ color: "var(--rd-teal)" }}
          />
          <div>
            <DialogTitle>{DECLARATION_TITLE}</DialogTitle>
            <DialogDescription>{DECLARATION_VERSION}</DialogDescription>
          </div>
        </div>
        <div className="rd-legal-body" tabIndex={0}>
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
        {readOnly ? (
          <div className="rd-legal-foot">
            <button
              type="button"
              className="rd-button rd-primary"
              onClick={onClose}
            >
              关闭
            </button>
          </div>
        ) : (
          <div className="rd-legal-foot">
            <label className="rd-legal-confirm">
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => setChecked(e.target.checked)}
                aria-label={DECLARATION_CONFIRM_LABEL}
              />
              <span>{DECLARATION_CONFIRM_LABEL}</span>
            </label>
            <button
              type="button"
              className="rd-button rd-primary"
              disabled={!checked}
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
