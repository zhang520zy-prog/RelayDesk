import mark from "../assets/relaydesk-mark.png";
export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="rd-brand">
      <img src={mark} alt="" width="36" height="36" />
      {!compact && <span>RelayDesk</span>}
    </div>
  );
}
