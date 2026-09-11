import React, { useEffect, useState } from 'react';
import { Check, Trash2 } from 'lucide-react';

import type { Plugin } from '@/types/plugin';
import { storage } from '@/lib/storage';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const EMPTY_VALUE_PLACEHOLDER = '__lnreader_empty__';

type PluginSettingsSectionProps = {
  plugin?: Plugin.PluginBase;
};

function PluginSettingsSection({ plugin }: PluginSettingsSectionProps) {
  const settings = plugin?.pluginSettings;
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [status, setStatus] = useState<'idle' | 'saved'>('idle');

  useEffect(() => {
    if (!settings) {
      setValues({});
      return;
    }
    const next: Record<string, unknown> = {};
    for (const [key, setting] of Object.entries(settings)) {
      const stored = storage.get(key);
      next[key] = stored !== undefined ? stored : setting.value;
    }
    setValues(next);
  }, [plugin?.id, settings]);

  if (!plugin || !settings || Object.keys(settings).length === 0) {
    return null;
  }

  const flashSaved = () => {
    setStatus('saved');
    window.setTimeout(() => setStatus('idle'), 1500);
  };

  const update = (key: string, value: unknown) => {
    storage.set(key, value);
    setValues(current => ({ ...current, [key]: value }));
    flashSaved();
  };

  const clearCache = () => {
    const next: Record<string, unknown> = {};
    for (const [key, setting] of Object.entries(settings)) {
      storage.delete(key);
      next[key] = setting.value;
    }
    setValues(next);
    flashSaved();
  };

  const renderSetting = (key: string, setting: Plugin.PluginSetting) => {
    const value = values[key];
    const id = `${plugin.id}-${key}`;

    switch (setting.type) {
      case 'Switch':
        return (
          <div key={key} className="flex items-center justify-between gap-4">
            <Label htmlFor={id} className="font-semibold text-foreground">
              {setting.label}
            </Label>
            <Switch
              id={id}
              checked={Boolean(value)}
              onCheckedChange={checked => update(key, checked)}
            />
          </div>
        );
      case 'Select': {
        const displayValue =
          value === '' ? EMPTY_VALUE_PLACEHOLDER : String(value ?? '');
        return (
          <div key={key} className="space-y-2">
            <Label htmlFor={id} className="font-semibold text-foreground">
              {setting.label}
            </Label>
            <Select
              value={displayValue}
              onValueChange={selected =>
                update(
                  key,
                  selected === EMPTY_VALUE_PLACEHOLDER ? '' : selected,
                )
              }
            >
              <SelectTrigger id={id}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {setting.options.map(option => (
                  <SelectItem
                    key={option.value || 'empty'}
                    value={
                      option.value === ''
                        ? EMPTY_VALUE_PLACEHOLDER
                        : option.value
                    }
                  >
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        );
      }
      case 'CheckboxGroup': {
        const selected = Array.isArray(value) ? value : [];
        return (
          <div key={key} className="space-y-3">
            <Label className="font-semibold text-foreground">
              {setting.label}
            </Label>
            <div className="space-y-2">
              {setting.options.map(option => {
                const id = `${plugin.id}-${key}-${option.value}`;
                return (
                  <div key={option.value} className="flex items-center gap-2">
                    <Checkbox
                      id={id}
                      checked={selected.includes(option.value)}
                      onCheckedChange={() =>
                        update(
                          key,
                          selected.includes(option.value)
                            ? selected.filter(v => v !== option.value)
                            : [...selected, option.value],
                        )
                      }
                    />
                    <Label
                      htmlFor={id}
                      className="text-sm font-normal cursor-pointer"
                    >
                      {option.label}
                    </Label>
                  </div>
                );
              })}
            </div>
          </div>
        );
      }
      default:
        return (
          <div key={key} className="space-y-2">
            <Label htmlFor={id} className="font-semibold text-foreground">
              {setting.label}
            </Label>
            <Input
              id={id}
              value={String(value ?? '')}
              onChange={e => update(key, e.target.value)}
              className="font-mono text-xs"
            />
          </div>
        );
    }
  };

  return (
    <Card className="p-6 relative">
      {status === 'saved' && (
        <div className="absolute top-4 right-4 z-10 bg-green-500/90 text-white px-4 py-2 rounded-md flex items-center gap-2 shadow-lg animate-in fade-in slide-in-from-top-2">
          <Check className="w-4 h-4" /> Plugin settings saved
        </div>
      )}

      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h2 className="text-lg font-semibold text-foreground">
            Plugin Settings
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Values for {plugin.name} are stored in your browser's localStorage.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={clearCache}>
          <Trash2 className="w-4 h-4" /> Clear cache
        </Button>
      </div>

      <div className="space-y-6">
        {Object.entries(settings).map(([key, setting]) =>
          renderSetting(key, setting),
        )}
      </div>

      <p className="text-xs text-muted-foreground mt-6">
        Some plugins read settings only when they load. Reload the page if a
        change has no effect.
      </p>
    </Card>
  );
}

export default PluginSettingsSection;
