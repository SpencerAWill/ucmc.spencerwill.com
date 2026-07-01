import type { EmergencyContactInput } from "#/server/profile/profile-schemas";

/**
 * Shape of every profile-editing form in the app: registration, the
 * `/account` Profile tab, the `/account/details` Details tab, and the
 * admin profile sheet. Kept as a single shape because TanStack Form's
 * `withForm` HOC has invariant generics — a field-group component
 * can't accept both a wider and a narrower parent form, so all
 * parents and all field groups must agree.
 *
 * Routes that only edit a subset (Profile = preferredName +
 * ucAffiliation; Details = fullName/phone + emergency contacts) still
 * initialize the full shape, but their server-fn submission only picks
 * the relevant fields.
 */
export interface ProfileFormShape {
  fullName: string;
  preferredName: string;
  phone: string;
  emergencyContacts: EmergencyContactInput[];
  ucAffiliation: "" | "student" | "faculty" | "staff" | "alum" | "community";
  bio: string;
  // Registration-only checkbox. Subset forms (Profile, Details, admin
  // sheet) keep the field on the shape so `PublicProfileFields` /
  // `PrivateDetailFields` (declared via `withForm` with the full
  // shape) match, but they never render or persist it; the
  // registration form's `registrationInputSchema` is what enforces
  // the literal-true requirement.
  policiesAck: boolean;
}

export const EMPTY_PROFILE_FORM_VALUES: ProfileFormShape = {
  fullName: "",
  preferredName: "",
  phone: "",
  emergencyContacts: [],
  ucAffiliation: "",
  bio: "",
  policiesAck: false,
};
