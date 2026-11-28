import { Policy } from '@nestjs/authorization';
import type { StaffUser } from '../../../infra/auth/staff-user.js';
import { hasAbility } from '../abilities.js';

/** Categorias de denúncia (ACL-01, CAT-02): só o ADMIN. */
@Policy()
export class CatalogPolicy {
  manageCategories(user: StaffUser | null): boolean {
    return hasAbility(user, 'categories.manage');
  }
}
