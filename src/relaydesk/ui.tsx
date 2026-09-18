import { forwardRef } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Input, type InputProps } from "@/components/ui/input";
export const Action = forwardRef<
  HTMLButtonElement,
  ButtonProps & { primary?: boolean }
>(({ primary, className = "", ...props }, ref) => (
  <Button
    ref={ref}
    variant="secondary"
    className={`rd-button ${primary ? "rd-primary" : ""} ${className}`}
    {...props}
  />
));
Action.displayName = "Action";
export const Field = forwardRef<HTMLInputElement, InputProps>(
  ({ className = "", ...props }, ref) => (
    <Input ref={ref} className={`rd-input ${className}`} {...props} />
  ),
);
Field.displayName = "Field";
