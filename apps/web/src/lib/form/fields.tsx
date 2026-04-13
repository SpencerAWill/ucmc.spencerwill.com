import { useId } from "react";
import { useStore } from "@tanstack/react-form";

import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import * as ShadcnSelect from "#/components/ui/select";
import { Slider as ShadcnSlider } from "#/components/ui/slider";
import { Switch as ShadcnSwitch } from "#/components/ui/switch";
import { Textarea as ShadcnTextarea } from "#/components/ui/textarea";

import { useFieldContext, useFormContext } from "#/lib/form/form-context";

export function SubscribeButton({
  label,
  className,
}: {
  label: string;
  className?: string;
}) {
  const form = useFormContext();
  return (
    <form.Subscribe selector={(state) => state.isSubmitting}>
      {(isSubmitting) => (
        <Button type="submit" disabled={isSubmitting} className={className}>
          {label}
        </Button>
      )}
    </form.Subscribe>
  );
}

function ErrorMessages({
  errors,
}: {
  errors: Array<string | { message: string }>;
}) {
  return (
    <>
      {errors.map((error) => (
        <p
          key={typeof error === "string" ? error : error.message}
          className="text-destructive mt-1 text-sm"
        >
          {typeof error === "string" ? error : error.message}
        </p>
      ))}
    </>
  );
}

export function TextField({
  label,
  placeholder,
  type = "text",
  autoComplete,
}: {
  label: string;
  placeholder?: string;
  type?: string;
  autoComplete?: string;
}) {
  const id = useId();
  const field = useFieldContext<string>();
  const errors = useStore(field.store, (state) => state.meta.errors);

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        autoComplete={autoComplete}
        value={field.state.value}
        placeholder={placeholder}
        onBlur={field.handleBlur}
        onChange={(e) => field.handleChange(e.target.value)}
      />
      {field.state.meta.isTouched && <ErrorMessages errors={errors} />}
    </div>
  );
}

export function TextArea({
  label,
  rows = 3,
}: {
  label: string;
  rows?: number;
}) {
  const id = useId();
  const field = useFieldContext<string>();
  const errors = useStore(field.store, (state) => state.meta.errors);

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <ShadcnTextarea
        id={id}
        value={field.state.value}
        onBlur={field.handleBlur}
        rows={rows}
        onChange={(e) => field.handleChange(e.target.value)}
      />
      {field.state.meta.isTouched && <ErrorMessages errors={errors} />}
    </div>
  );
}

export function Select({
  label,
  values,
  placeholder,
}: {
  label: string;
  values: Array<{ label: string; value: string }>;
  placeholder?: string;
}) {
  const id = useId();
  const field = useFieldContext<string>();
  const errors = useStore(field.store, (state) => state.meta.errors);

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <ShadcnSelect.Select
        name={field.name}
        value={field.state.value}
        onValueChange={(value) => field.handleChange(value)}
      >
        <ShadcnSelect.SelectTrigger id={id} className="w-full">
          <ShadcnSelect.SelectValue placeholder={placeholder} />
        </ShadcnSelect.SelectTrigger>
        <ShadcnSelect.SelectContent className="bg-background text-foreground">
          <ShadcnSelect.SelectGroup>
            <ShadcnSelect.SelectLabel>{label}</ShadcnSelect.SelectLabel>
            {values.map((value) => (
              <ShadcnSelect.SelectItem
                key={value.value}
                value={value.value}
                className="text-foreground"
              >
                {value.label}
              </ShadcnSelect.SelectItem>
            ))}
          </ShadcnSelect.SelectGroup>
        </ShadcnSelect.SelectContent>
      </ShadcnSelect.Select>
      {field.state.meta.isTouched && <ErrorMessages errors={errors} />}
    </div>
  );
}

export function Slider({ label }: { label: string }) {
  const id = useId();
  const field = useFieldContext<number>();
  const errors = useStore(field.store, (state) => state.meta.errors);

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <ShadcnSlider
        id={id}
        onBlur={field.handleBlur}
        value={[field.state.value]}
        onValueChange={(value) => field.handleChange(value[0])}
      />
      {field.state.meta.isTouched && <ErrorMessages errors={errors} />}
    </div>
  );
}

export function Switch({ label }: { label: string }) {
  const id = useId();
  const field = useFieldContext<boolean>();
  const errors = useStore(field.store, (state) => state.meta.errors);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <ShadcnSwitch
          id={id}
          onBlur={field.handleBlur}
          checked={field.state.value}
          onCheckedChange={(checked) => field.handleChange(checked)}
        />
        <Label htmlFor={id}>{label}</Label>
      </div>
      {field.state.meta.isTouched && <ErrorMessages errors={errors} />}
    </div>
  );
}
