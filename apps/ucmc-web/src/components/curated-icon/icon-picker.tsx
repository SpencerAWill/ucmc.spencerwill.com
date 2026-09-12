/**
 * Select over the curated icon list, previewing each glyph beside its
 * name. Shared by the landing activities editor and /volunteer's
 * program editor.
 */
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { CuratedIcon } from "#/components/curated-icon/curated-icon";
import { CURATED_ICONS } from "#/components/curated-icon/icon-names";
import type { CuratedIconName } from "#/components/curated-icon/icon-names";

export interface IconPickerProps {
  value: CuratedIconName;
  onChange: (next: CuratedIconName) => void;
  /**
   * Forwarded to the trigger so a `<Label htmlFor>` actually resolves.
   * Without it the label is inert on click and the combobox's accessible
   * name falls back to the raw icon name ("HandHeart"), which tells a
   * screen-reader user nothing about what the control selects.
   */
  id?: string;
}

export function IconPicker({ value, onChange, id }: IconPickerProps) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as CuratedIconName)}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {CURATED_ICONS.map((name) => (
          <SelectItem key={name} value={name}>
            <span className="flex items-center gap-2">
              <CuratedIcon name={name} className="size-4" />
              <span>{name}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
