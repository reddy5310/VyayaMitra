import { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, Lock } from 'lucide-react';
import { Button, Card, Field, Input, Notice } from '@/ui';

/**
 * The password lives only in this component's state. It is cleared the moment it is submitted
 * (the caller passes it straight to the parser) and disappears with the component on cancel.
 */
export function PasswordStep({
  fileName,
  wrong,
  busy,
  onSubmit,
  onCancel,
}: {
  fileName: string;
  wrong: boolean;
  busy: boolean;
  onSubmit: (password: string) => void;
  onCancel: () => void;
}) {
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
  }, [wrong]);

  function submit() {
    if (!password) return;
    const value = password;
    setPassword('');
    setShow(false);
    onSubmit(value);
  }

  return (
    <Card className="space-y-4">
      <div className="flex items-start gap-3">
        <span className="rounded-2xl bg-warning-soft p-2.5 text-warning">
          <Lock className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-fg">This statement is password-protected</h2>
          <p className="truncate text-sm text-fg-muted">{fileName}</p>
        </div>
      </div>

      {wrong && (
        <Notice tone="negative" title="That password did not open the statement">
          Check for typos and try again.
        </Notice>
      )}

      <form
        className="space-y-4"
        autoComplete="off"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field
          label="Statement password"
          hint="Banks often use a mix such as the first four letters of your name plus your date of birth (DDMM), or the last digits of your card or phone number. Check the email your bank sent with the statement. The password is used on this device and is never saved."
        >
          {({ id, describedBy }) => (
            <div className="flex gap-2">
              <Input
                ref={input}
                id={id}
                aria-describedby={describedBy}
                type={show ? 'text' : 'password'}
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <Button
                variant="outline"
                aria-label={show ? 'Hide password' : 'Show password'}
                aria-pressed={show}
                onClick={() => setShow((v) => !v)}
                icon={show ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
              />
            </div>
          )}
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={busy} disabled={!password}>
            Unlock statement
          </Button>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
