import { createFormHook } from "@tanstack/react-form";

import {
  Select,
  SubscribeButton,
  TextArea,
  TextField,
} from "#/lib/form/fields";
import { fieldContext, formContext } from "#/lib/form/form-context";

export const { useAppForm } = createFormHook({
  fieldComponents: {
    TextField,
    Select,
    TextArea,
  },
  formComponents: {
    SubscribeButton,
  },
  fieldContext,
  formContext,
});
