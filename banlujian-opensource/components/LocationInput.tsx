import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { getTips } from "@/lib/api";
import type { Poi } from "@/lib/types";

function useDebounced(value: string, delay: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

type Props = {
  label: string;
  accentClass: string;
  placeholder: string;
  value: Poi | null;
  onChange: (poi: Poi | null) => void;
};

export function LocationInput({ label, accentClass, placeholder, value, onChange }: Props) {
  const [text, setText] = useState(value?.name ?? "");
  const [items, setItems] = useState<Poi[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounced = useDebounced(text, 300);
  const blurTimer = useRef<number | null>(null);

  useEffect(() => {
    const q = debounced.trim();
    if (q.length < 2 || q === value?.name) {
      setItems([]);
      setOpen(false);
      return;
    }
    let alive = true;
    setLoading(true);
    getTips(q)
      .then((res) => {
        if (!alive) return;
        setItems(res.items);
        setOpen(res.items.length > 0);
      })
      .catch(() => {
        if (alive) {
          setItems([]);
          setOpen(false);
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [debounced, value?.name]);

  const select = (poi: Poi) => {
    onChange(poi);
    setText(poi.name);
    setOpen(false);
    setItems([]);
  };

  return (
    <div className="relative">
      <span className="pointer-events-none absolute top-1/2 left-3 z-10 -translate-y-1/2 text-xs font-semibold">
        <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-white ${accentClass}`}>
          {label}
        </span>
      </span>
      <Input
        role="combobox"
        aria-expanded={open}
        aria-label={`${label}方位置`}
        className="pl-11"
        placeholder={placeholder}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (!e.target.value) onChange(null);
        }}
        onFocus={() => {
          if (blurTimer.current) window.clearTimeout(blurTimer.current);
          if (items.length > 0) setOpen(true);
        }}
        onBlur={() => {
          blurTimer.current = window.setTimeout(() => setOpen(false), 150);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && open && items.length > 0) {
            e.preventDefault();
            select(items[0]);
          }
        }}
      />
      {loading && (
        <span className="absolute top-1/2 right-3 -translate-y-1/2">
          <Spinner className="h-4 w-4" />
        </span>
      )}
      {open && items.length > 0 && (
        <ul
          role="listbox"
          className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-border bg-popover shadow-md"
        >
          {items.map((poi) => (
            <li key={poi.id}>
              <button
                type="button"
                role="option"
                aria-selected={value?.id === poi.id}
                className="w-full px-3 py-2 text-left text-sm hover:bg-accent"
                onMouseDown={(e) => {
                  e.preventDefault();
                  select(poi);
                }}
              >
                <span className="font-medium">{poi.name}</span>
                {poi.address && <span className="block text-xs text-muted-foreground">{poi.address}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
