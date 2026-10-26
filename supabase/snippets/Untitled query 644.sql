insert into profiles (id, full_name, role)
select id, 'Test Administrator', 'administrator'
from auth.users
where email = 'admin@test.com';