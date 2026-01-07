import { useState, useRef, useEffect } from "react";
import { User } from "../types";
import ChangePasswordModal from "./ChangePasswordModal";
import "./UserProfile.css";

interface Props {
  user: User;
  onLogout: () => void;
}

function UserProfile({ user, onLogout }: Props) {
  const [showDropdown, setShowDropdown] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setShowDropdown(false);
      }
    };

    if (showDropdown) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showDropdown]);

  const getRoleBadgeClass = (role: string) => {
    // Handle both old ("Admin") and new ("ADMIN") role values
    return role === "ADMIN" || role === "Admin"
      ? "role-badge-admin"
      : "role-badge-member";
  };

  return (
    <div className="user-profile" ref={dropdownRef}>
      <button
        className="user-profile-button"
        onClick={() => setShowDropdown(!showDropdown)}
        title="User menu"
      >
        <div className="user-avatar">{user.email.charAt(0).toUpperCase()}</div>
        <span className="user-email-short">{user.email.split("@")[0]}</span>
      </button>

      {showDropdown && (
        <div className="user-dropdown">
          <div className="user-dropdown-header">
            <div className="user-avatar-large">
              {user.email.charAt(0).toUpperCase()}
            </div>
            <div className="user-info">
              <div className="user-email">{user.email}</div>
              <div className={`role-badge ${getRoleBadgeClass(user.role)}`}>
                {user.role}
              </div>
            </div>
          </div>

          <div className="user-dropdown-divider"></div>

          <button
            className="user-dropdown-item"
            onClick={() => {
              setShowDropdown(false);
              setShowChangePassword(true);
            }}
          >
            <span>🔑</span>
            Change Password
          </button>

          <button
            className="user-dropdown-item logout-button"
            onClick={() => {
              setShowDropdown(false);
              onLogout();
            }}
          >
            <span>🚪</span>
            Logout
          </button>
        </div>
      )}

      {showChangePassword && (
        <ChangePasswordModal
          user={user}
          onClose={() => setShowChangePassword(false)}
          onSuccess={() => {
            // Password changed successfully - could optionally log out the user
          }}
        />
      )}
    </div>
  );
}

export default UserProfile;
