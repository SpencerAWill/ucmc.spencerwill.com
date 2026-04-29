import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { ActivityIcon } from "#/features/landing/components/activity-icon";
import { ACTIVITY_ICONS } from "#/features/landing/server/landing-schemas";
import type { ActivityIcon as ActivityIconName } from "#/features/landing/server/landing-schemas";

export interface IconPickerProps {
  value: ActivityIconName;
  onChange: (next: ActivityIconName) => void;
}

export function IconPicker({ value, onChange }: IconPickerProps) {
  return (
    <Select
      value={value}
      onValueChange={(v) => onChange(v as ActivityIconName)}
    >
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ACTIVITY_ICONS.map((name) => (
          <SelectItem key={name} value={name}>
            <span className="flex items-center gap-2">
              <ActivityIcon name={name} className="size-4" />
              <span>{name}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
