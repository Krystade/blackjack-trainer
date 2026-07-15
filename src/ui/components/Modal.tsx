import type { ReactNode } from 'react';

interface ModalProps {
  title?: string;
  children: ReactNode;
}

export function Modal({ title, children }: ModalProps) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        {title ? <h2 className="modal-title">{title}</h2> : null}
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
