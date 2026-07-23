"use client";

import type { HTMLAttributes, ReactNode } from "react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  ContextMenu,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/hooks/useTranslation";
import {
  Folder,
  FolderOpen,
  File,
  CaretRight,
  Plus,
} from "@phosphor-icons/react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

interface FileTreeContextType {
  expandedPaths: Set<string>;
  togglePath: (path: string) => void;
  selectedPath?: string;
  onSelect?: (path: string) => void;
  onAdd?: (path: string) => void;
  /**
   * Separate selected-folder channel from selectedPath so folder and file
   * selection can coexist without one stomping the other. Folder
   * selection is what drives the "create in this folder" default target.
   */
  selectedFolderPath?: string;
  onSelectFolder?: (folderPath: string) => void;
}

// Module-scope immutable empty Set. Inlining `new Set()` as a destructuring
// default parameter (e.g. `defaultExpanded = new Set()`) triggered a production
// ReferenceError under Next.js 16 + Turbopack in v0.50.2 (Sentry NEXT-PA).
const EMPTY_EXPANDED: Set<string> = new Set();

// Default noop for context default value
// oxlint-disable-next-line eslint(no-empty-function)
const noop = () => {};

const FileTreeContext = createContext<FileTreeContextType>({
  // oxlint-disable-next-line eslint-plugin-unicorn(no-new-builtin)
  expandedPaths: new Set(),
  togglePath: noop,
});

export type FileTreeProps = HTMLAttributes<HTMLDivElement> & {
  expanded?: Set<string>;
  defaultExpanded?: Set<string>;
  selectedPath?: string;
  onSelect?: (path: string) => void;
  onAdd?: (path: string) => void;
  selectedFolderPath?: string;
  onSelectFolder?: (folderPath: string) => void;
  onExpandedChange?: (expanded: Set<string>) => void;
};

export const FileTree = ({
  expanded: controlledExpanded,
  defaultExpanded = EMPTY_EXPANDED,
  selectedPath,
  onSelect,
  onAdd,
  selectedFolderPath,
  onSelectFolder,
  onExpandedChange,
  className,
  children,
  ...props
}: FileTreeProps) => {
  const [internalExpanded, setInternalExpanded] = useState(defaultExpanded);
  const expandedPaths = controlledExpanded ?? internalExpanded;

  const togglePath = useCallback(
    (path: string) => {
      const newExpanded = new Set(expandedPaths);
      if (newExpanded.has(path)) {
        newExpanded.delete(path);
      } else {
        newExpanded.add(path);
      }
      setInternalExpanded(newExpanded);
      onExpandedChange?.(newExpanded);
    },
    [expandedPaths, onExpandedChange]
  );

  const contextValue = useMemo(
    () => ({ expandedPaths, onAdd, onSelect, selectedPath, togglePath, selectedFolderPath, onSelectFolder }),
    [expandedPaths, onAdd, onSelect, selectedPath, togglePath, selectedFolderPath, onSelectFolder]
  );

  return (
    <FileTreeContext.Provider value={contextValue}>
      <div
        className={cn(
          // min-w-max lets the tree grow to its widest row (deep nesting +
          // long names) instead of being clamped to the viewport, so the
          // scroll container can show a horizontal scrollbar. min-width
          // (not width) keeps rows filling the viewport when content is
          // narrow, so hover/selection highlights still span full width.
          "min-w-max rounded-lg border bg-background font-mono text-sm",
          className
        )}
        role="tree"
        {...props}
      >
        <div className="p-2">{children}</div>
      </div>
    </FileTreeContext.Provider>
  );
};

interface FileTreeFolderContextType {
  path: string;
  name: string;
  isExpanded: boolean;
}

const FileTreeFolderContext = createContext<FileTreeFolderContextType>({
  isExpanded: false,
  name: "",
  path: "",
});

export type FileTreeFolderProps = HTMLAttributes<HTMLDivElement> & {
  path: string;
  name: string;
  /**
   * Optional right-click menu content (a <ContextMenuContent> element). When
   * provided, the folder ROW becomes a context-menu trigger. Nested asChild
   * (ContextMenuTrigger → CollapsibleTrigger → div) composes via Radix Slot so
   * left-click still toggles expand while right-click opens the menu.
   */
  contextMenuContent?: ReactNode;
};

export const FileTreeFolder = ({
  path,
  name,
  className,
  children,
  contextMenuContent,
  ...props
}: FileTreeFolderProps) => {
  const { expandedPaths, togglePath, selectedFolderPath, onSelectFolder } =
    useContext(FileTreeContext);
  const isExpanded = expandedPaths.has(path);
  const isSelected = selectedFolderPath === path;

  const handleToggle = useCallback(() => {
    togglePath(path);
    // Clicking a folder row both toggles expand/collapse and marks it
    // selected — matches VS Code's Explorer behavior. Selection drives
    // the "create inside this folder" default target in the panel's
    // new-item flow.
    onSelectFolder?.(path);
  }, [togglePath, onSelectFolder, path]);

  const folderContextValue = useMemo(
    () => ({ isExpanded, name, path }),
    [isExpanded, name, path]
  );

  const rowInner = (
    <>
      <span className="shrink-0 rounded p-0.5">
        <CaretRight
          size={16}
          className={cn(
            "text-muted-foreground transition-transform",
            isExpanded && "rotate-90"
          )}
        />
      </span>
      <FileTreeIcon>
        {isExpanded ? (
          <FolderOpen size={16} className="text-muted-foreground" />
        ) : (
          <Folder size={16} className="text-muted-foreground" />
        )}
      </FileTreeIcon>
      <FileTreeName>{name}</FileTreeName>
    </>
  );

  const row = (
    <div
      className={cn(
        "flex w-full cursor-pointer items-center gap-1 rounded px-2 py-1 text-left transition-colors hover:bg-muted/50",
        isSelected && "bg-muted",
      )}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleToggle();
        }
      }}
    >
      {rowInner}
    </div>
  );

  const trigger = (
    <CollapsibleTrigger asChild>{row}</CollapsibleTrigger>
  );

  return (
    <FileTreeFolderContext.Provider value={folderContextValue}>
      <Collapsible onOpenChange={handleToggle} open={isExpanded}>
        <div
          className={cn("", className)}
          role="treeitem"
          {...props}
        >
          {contextMenuContent ? (
            <ContextMenu>
              <ContextMenuTrigger asChild>{trigger}</ContextMenuTrigger>
              {contextMenuContent}
            </ContextMenu>
          ) : (
            trigger
          )}
          <CollapsibleContent>
            <div className="ml-4 border-l pl-2">{children}</div>
          </CollapsibleContent>
        </div>
      </Collapsible>
    </FileTreeFolderContext.Provider>
  );
};

interface FileTreeFileContextType {
  path: string;
  name: string;
}

const FileTreeFileContext = createContext<FileTreeFileContextType>({
  name: "",
  path: "",
});

export type FileTreeFileProps = HTMLAttributes<HTMLDivElement> & {
  path: string;
  name: string;
  icon?: ReactNode;
  /**
   * Optional right-click menu content (a <ContextMenuContent> element). When
   * provided, the file row becomes a context-menu trigger; left-click still
   * selects the file as before.
   */
  contextMenuContent?: ReactNode;
};

export const FileTreeFile = ({
  path,
  name,
  icon,
  className,
  children,
  contextMenuContent,
  ...props
}: FileTreeFileProps) => {
  const { selectedPath, onSelect, onAdd } = useContext(FileTreeContext);
  const { t } = useTranslation();
  const isSelected = selectedPath === path;

  const handleClick = useCallback(() => {
    onSelect?.(path);
  }, [onSelect, path]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        onSelect?.(path);
      }
    },
    [onSelect, path]
  );

  const handleAdd = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onAdd?.(path);
    },
    [onAdd, path]
  );

  const fileContextValue = useMemo(() => ({ name, path }), [name, path]);

  const row = (
    <div
      className={cn(
        "group/file flex cursor-pointer items-center gap-1 rounded px-2 py-1 transition-colors hover:bg-muted/50",
        isSelected && "bg-muted",
        className
      )}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      role="treeitem"
      tabIndex={0}
      {...props}
    >
      {children ?? (
        <>
          <FileTreeIcon>
            {icon ?? <File size={16} className="text-muted-foreground" />}
          </FileTreeIcon>
          <FileTreeName>{name}</FileTreeName>
          {onAdd && (
            <button
              type="button"
              className="ml-auto flex size-5 shrink-0 items-center justify-center rounded opacity-0 transition-opacity hover:bg-muted group-hover/file:opacity-100"
              onClick={handleAdd}
              title={t("fileTree.addToChat")}
            >
              <Plus size={12} className="text-muted-foreground" />
            </button>
          )}
        </>
      )}
    </div>
  );

  return (
    <FileTreeFileContext.Provider value={fileContextValue}>
      {contextMenuContent ? (
        <ContextMenu>
          <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
          {contextMenuContent}
        </ContextMenu>
      ) : (
        row
      )}
    </FileTreeFileContext.Provider>
  );
};

export type FileTreeIconProps = HTMLAttributes<HTMLSpanElement>;

export const FileTreeIcon = ({
  className,
  children,
  ...props
}: FileTreeIconProps) => (
  <span className={cn("shrink-0", className)} {...props}>
    {children}
  </span>
);

export type FileTreeNameProps = HTMLAttributes<HTMLSpanElement>;

export const FileTreeName = ({
  className,
  children,
  ...props
}: FileTreeNameProps) => (
  // whitespace-nowrap (not truncate) keeps the name on one line but lets it
  // extend to full length — combined with the tree's min-w-max + the scroll
  // container's overflow-auto, deep/long names stay fully visible via the
  // horizontal scrollbar instead of being clipped with an ellipsis.
  <span className={cn("whitespace-nowrap", className)} {...props}>
    {children}
  </span>
);

export type FileTreeActionsProps = HTMLAttributes<HTMLDivElement>;

const stopPropagation = (e: React.SyntheticEvent) => e.stopPropagation();

export const FileTreeActions = ({
  className,
  children,
  ...props
}: FileTreeActionsProps) => (
  // biome-ignore lint/a11y/noNoninteractiveElementInteractions: stopPropagation required for nested interactions
  // biome-ignore lint/a11y/useSemanticElements: fieldset doesn't fit this UI pattern
  <div
    className={cn("ml-auto flex items-center gap-1", className)}
    onClick={stopPropagation}
    onKeyDown={stopPropagation}
    role="group"
    {...props}
  >
    {children}
  </div>
);
