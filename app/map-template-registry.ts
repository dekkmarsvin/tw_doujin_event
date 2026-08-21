import { validateEventMapLayout, type LayoutValidation } from "./event-map";
import { validateLayout as validateFf47Layout } from "./ff47-map-template-validator";

const TEMPLATE_VALIDATORS: ReadonlyMap<string, (value: unknown) => LayoutValidation> = new Map([
  ["FF47", validateFf47Layout],
]);

export function validateMapTemplateLayout(template: string, value: unknown) {
  return (TEMPLATE_VALIDATORS.get(template) ?? validateEventMapLayout)(value);
}
