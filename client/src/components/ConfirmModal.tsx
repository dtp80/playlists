import "./ConfirmModal.css";

interface Props {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  confirmVariant?: "danger" | "primary" | "warning" | "success";
  onConfirm?: () => void;
  onCancel: () => void;
}

function ConfirmModal({
  title = "Confirm Action",
  message,
  confirmText = "OK",
  cancelText,
  confirmVariant = "primary",
  onConfirm,
  onCancel,
}: Props) {
  const isInfoMode = !onConfirm || !cancelText;

  const handleConfirm = () => {
    if (onConfirm) {
      onConfirm();
    }
    onCancel();
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div
        className="modal-content confirm-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="modal-close" onClick={onCancel}>
            ×
          </button>
        </div>
        <div className="modal-body">
          <p className="confirm-message">{message}</p>
        </div>
        <div className="modal-footer">
          {!isInfoMode && (
            <button className="btn btn-secondary" onClick={onCancel}>
              {cancelText}
            </button>
          )}
          <button
            className={`btn btn-${confirmVariant}`}
            onClick={handleConfirm}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmModal;
