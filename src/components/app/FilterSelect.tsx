import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const ALL = "__all";

export function FilterSelect({
  label,
  value,
  onChange,
  options,
  noAll,
}: {
  label: string;
  value?: string;
  onChange: (v: string | undefined) => void;
  options: [string, string][];
  noAll?: boolean;
}) {
  return (
    <Select
      value={value ?? ALL}
      onValueChange={(v) => onChange(v === ALL && !noAll ? undefined : v)}
    >
      <SelectTrigger
        className="w-auto min-w-[140px]"
        aria-label={label}
        title={`Filtrar por ${label}`}
      >
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        {!noAll && <SelectItem value={ALL}>{label}: todos</SelectItem>}
        {options.map(([v, l]) => (
          <SelectItem key={v} value={v}>
            {l}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
