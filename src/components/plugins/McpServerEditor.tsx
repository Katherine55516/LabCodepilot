'use client';

import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { HardDrives, WifiHigh, Globe, Code } from "@/components/ui/icon";
import { useTranslation } from '@/hooks/useTranslation';
import type { MCPServer } from '@/types';

type ServerType = 'stdio' | 'sse' | 'http';

interface McpServerEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name?: string;
  server?: MCPServer;
  onSave: (name: string, server: MCPServer) => Promise<void> | void;
}

export function McpServerEditor({
  open,
  onOpenChange,
  name: initialName,
  server: initialServer,
  onSave,
}: McpServerEditorProps) {
  const isEditing = !!initialName;
  const { t } = useTranslation();
  const [name, setName] = useState(initialName || '');
  const [serverType, setServerType] = useState<ServerType>(
    initialServer?.type || 'stdio'
  );
  const [command, setCommand] = useState(initialServer?.command || '');
  const [args, setArgs] = useState(initialServer?.args?.join('\n') || '');
  const [url, setUrl] = useState(initialServer?.url || '');
  const [headersText, setHeadersText] = useState(
    initialServer?.headers ? JSON.stringify(initialServer.headers, null, 2) : '{}'
  );
  const [envText, setEnvText] = useState(
    initialServer?.env ? JSON.stringify(initialServer.env, null, 2) : '{}'
  );
  const [jsonMode, setJsonMode] = useState(false);
  const [jsonText, setJsonText] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Reset form when dialog opens with new data
  /* eslint-disable react-hooks/set-state-in-effect -- intentional form reset when dialog opens with new props */
  useEffect(() => {
    if (open) {
      setName(initialName || '');
      setServerType(initialServer?.type || 'stdio');
      setCommand(initialServer?.command || '');
      setArgs(initialServer?.args?.join('\n') || '');
      setUrl(initialServer?.url || '');
      setHeadersText(
        initialServer?.headers
          ? JSON.stringify(initialServer.headers, null, 2)
          : '{}'
      );
      setEnvText(
        initialServer?.env
          ? JSON.stringify(initialServer.env, null, 2)
          : '{}'
      );
      setJsonMode(false);
      setJsonText(
        initialServer
          ? JSON.stringify(initialServer, null, 2)
          : '{\n  "command": "",\n  "args": []\n}'
      );
      setError(null);
    }
  }, [open, initialName, initialServer]);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function handleSave() {
    setError(null);

    if (jsonMode) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(jsonText);
      } catch {
        setError(t('mcp.invalidJsonConfig'));
        return;
      }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        setError(t('mcp.jsonMustBeObject'));
        return;
      }

      // Accept both shapes:
      //   1. Single server object:        { command, args, ... }
      //   2. Registry wrapper (standard): { mcpServers: { "<name>": { command, args, ... } } }
      // The wrapper form is what MCP server READMEs / Anthropic docs / `claude mcp add-json`
      // emit, so users frequently paste it as-is.
      const obj = parsed as Record<string, unknown>;
      let serverConfig: MCPServer = obj as MCPServer;
      let detectedName: string | undefined;

      if (obj.mcpServers && typeof obj.mcpServers === 'object' && !Array.isArray(obj.mcpServers)) {
        const inner = obj.mcpServers as Record<string, unknown>;
        const keys = Object.keys(inner);
        if (keys.length === 0) {
          setError(t('mcp.jsonEmptyWrapper'));
          return;
        }
        if (keys.length > 1) {
          setError(t('mcp.jsonMultipleServers'));
          return;
        }
        detectedName = keys[0];
        serverConfig = inner[keys[0]] as MCPServer;
        if (typeof serverConfig !== 'object' || serverConfig === null) {
          setError(t('mcp.jsonMustBeObject'));
          return;
        }
      }

      const finalName = name.trim() || detectedName || '';
      if (!finalName) {
        setError(t('mcp.serverNameRequired'));
        return;
      }

      try {
        await onSave(finalName, serverConfig);
        onOpenChange(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : t('mcp.saveFailed'));
      }
      return;
    }

    if (!name.trim()) {
      setError(t('mcp.serverNameRequired'));
      return;
    }

    // Validate based on server type
    if (serverType === 'stdio') {
      if (!command.trim()) {
        setError('Command is required for stdio servers');
        return;
      }
    } else {
      if (!url.trim()) {
        setError('URL is required for SSE/HTTP servers');
        return;
      }
    }

    let env: Record<string, string> | undefined;
    try {
      const parsed = JSON.parse(envText);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        env = Object.keys(parsed).length > 0 ? parsed : undefined;
      } else {
        setError('Environment must be a JSON object');
        return;
      }
    } catch {
      setError('Invalid JSON in environment variables');
      return;
    }

    let headers: Record<string, string> | undefined;
    if (serverType !== 'stdio') {
      try {
        const parsed = JSON.parse(headersText);
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          headers = Object.keys(parsed).length > 0 ? parsed : undefined;
        } else {
          setError('Headers must be a JSON object');
          return;
        }
      } catch {
        setError('Invalid JSON in headers');
        return;
      }
    }

    const serverArgs = args
      .split('\n')
      .map((s: string) => s.trim())
      .filter(Boolean);

    const server: MCPServer = serverType === 'stdio'
      ? {
          command: command.trim(),
          ...(serverArgs.length > 0 ? { args: serverArgs } : {}),
          ...(env ? { env } : {}),
        }
      : {
          type: serverType,
          ...(url ? { url: url.trim() } : {}),
          ...(serverArgs.length > 0 ? { args: serverArgs } : {}),
          ...(env ? { env } : {}),
          ...(headers ? { headers } : {}),
        };

    try {
      await onSave(name.trim(), server);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('mcp.saveFailed'));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[550px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? `${t('mcp.editServer')}: ${initialName}` : t('mcp.addServer')}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="server-name">{t('mcp.serverName')}</Label>
            <Input
              id="server-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              placeholder="my-mcp-server"
              disabled={isEditing}
            />
          </div>

          <div className="flex items-center gap-2">
            <Label className="shrink-0">Edit Mode:</Label>
            <Button
              variant={jsonMode ? 'outline' : 'default'}
              size="sm"
              onClick={() => {
                setJsonMode(false);
                setError(null);
              }}
            >
              {t('mcp.formTab')}
            </Button>
            <Button
              variant={jsonMode ? 'default' : 'outline'}
              size="sm"
              className="gap-1.5"
              onClick={() => {
                // Build current config as JSON for the editor
                const currentConfig: Record<string, unknown> = {};
                if (serverType !== 'stdio') {
                  currentConfig.type = serverType;
                  if (url) currentConfig.url = url;
                } else {
                  currentConfig.command = command;
                }
                const argsArr = args.split('\n').map(s => s.trim()).filter(Boolean);
                if (argsArr.length > 0) currentConfig.args = argsArr;
                try {
                  const envParsed = JSON.parse(envText);
                  if (Object.keys(envParsed).length > 0) currentConfig.env = envParsed;
                } catch { /* ignore */ }
                try {
                  const headersParsed = JSON.parse(headersText);
                  if (Object.keys(headersParsed).length > 0) currentConfig.headers = headersParsed;
                } catch { /* ignore */ }
                setJsonText(JSON.stringify(currentConfig, null, 2));
                setJsonMode(true);
                setError(null);
              }}
            >
              <Code size={14} />
              {t('mcp.jsonEditTab')}
            </Button>
          </div>

          {jsonMode ? (
            <div className="space-y-2">
              <Label>{t('mcp.jsonModeLabel')}</Label>
              <p className="text-xs text-muted-foreground">{t('mcp.jsonModeHint')}</p>
              <Textarea
                value={jsonText}
                onChange={(e) => {
                  setJsonText(e.target.value);
                  setError(null);
                }}
                className="font-mono text-sm min-h-[250px]"
                placeholder={'{"command": "npx", "args": ["-y", "@server/name"]}\n\n// or paste a registry-format JSON:\n{"mcpServers": {"playwright": {"command": "npx", "args": ["-y", "@playwright/mcp@latest"]}}}'}
              />
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <Label>{t('mcp.serverType')}</Label>
                <Tabs
                  value={serverType}
                  onValueChange={(v) => {
                    setServerType(v as ServerType);
                    setError(null);
                  }}
                >
                  <TabsList className="w-full">
                    <TabsTrigger value="stdio" className="flex-1 gap-1.5">
                      <HardDrives size={14} />
                      stdio
                    </TabsTrigger>
                    <TabsTrigger value="sse" className="flex-1 gap-1.5">
                      <WifiHigh size={14} />
                      SSE
                    </TabsTrigger>
                    <TabsTrigger value="http" className="flex-1 gap-1.5">
                      <Globe size={14} />
                      HTTP
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>

              {serverType === 'stdio' ? (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="server-command">{t('mcp.command')}</Label>
                    <Input
                      id="server-command"
                      value={command}
                      onChange={(e) => {
                        setCommand(e.target.value);
                        setError(null);
                      }}
                      placeholder="npx -y @modelcontextprotocol/server-name"
                      className="font-mono text-sm"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="server-args">{t('mcp.argsLabel')}</Label>
                    <Textarea
                      id="server-args"
                      value={args}
                      onChange={(e) => setArgs(e.target.value)}
                      placeholder={"--flag\nvalue"}
                      className="font-mono text-sm min-h-[80px]"
                    />
                  </div>
                </>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="server-url">{t('mcp.url')}</Label>
                    <Input
                      id="server-url"
                      value={url}
                      onChange={(e) => {
                        setUrl(e.target.value);
                        setError(null);
                      }}
                      placeholder={
                        serverType === 'sse'
                          ? 'http://localhost:3001/sse'
                          : 'http://localhost:3001'
                      }
                      className="font-mono text-sm"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="server-headers">{t('mcp.headers')}</Label>
                    <Textarea
                      id="server-headers"
                      value={headersText}
                      onChange={(e) => {
                        setHeadersText(e.target.value);
                        setError(null);
                      }}
                      placeholder='{"Authorization": "Bearer ..."}'
                      className="font-mono text-sm min-h-[80px]"
                    />
                  </div>
                </>
              )}

              <div className="space-y-2">
                <Label htmlFor="server-env">{t('mcp.envVars')}</Label>
                <Textarea
                  id="server-env"
                  value={envText}
                  onChange={(e) => {
                    setEnvText(e.target.value);
                    setError(null);
                  }}
                  placeholder='{"API_KEY": "..."}'
                  className="font-mono text-sm min-h-[80px]"
                />
              </div>
            </>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSave}>
            {isEditing ? t('mcp.saveChanges') : t('mcp.addServer')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
