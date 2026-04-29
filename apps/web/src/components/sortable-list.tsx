/**
 * Thin wrapper around `@dnd-kit/sortable` for vertical lists. Encapsulates
 * sensors + DndContext + SortableContext + arrayMove so consumers only deal
 * with their item shape and a render-prop per row.
 *
 * Usage:
 *
 *   <SortableList ids={items.map((i) => i.id)} onReorder={(ids) => ...}>
 *     {items.map((item) => (
 *       <SortableItem key={item.id} id={item.id}>
 *         {({ setNodeRef, style, attributes, listeners, isDragging }) => (
 *           <li ref={setNodeRef} style={style}>
 *             <button {...attributes} {...listeners}>
 *               <GripVertical />
 *             </button>
 *             ...
 *           </li>
 *         )}
 *       </SortableItem>
 *     ))}
 *   </SortableList>
 */
import type { DragEndEvent } from "@dnd-kit/core";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ReactNode } from "react";

export interface SortableItemRenderProps {
  setNodeRef: (node: HTMLElement | null) => void;
  style: React.CSSProperties;
  attributes: ReturnType<typeof useSortable>["attributes"];
  listeners: ReturnType<typeof useSortable>["listeners"];
  isDragging: boolean;
}

export function SortableList({
  ids,
  onReorder,
  children,
  disabled,
}: {
  ids: string[];
  onReorder: (newIds: string[]) => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }
    const oldIdx = ids.indexOf(active.id as string);
    const newIdx = ids.indexOf(over.id as string);
    if (oldIdx === -1 || newIdx === -1) {
      return;
    }
    onReorder(arrayMove(ids, oldIdx, newIdx));
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={disabled ? undefined : handleDragEnd}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  );
}

export function SortableItem({
  id,
  children,
}: {
  id: string;
  children: (props: SortableItemRenderProps) => ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
  };

  return children({ setNodeRef, style, attributes, listeners, isDragging });
}
