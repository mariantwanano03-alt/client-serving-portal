insert into profiles (id, full_name, role)
select id, 'Test Senior Developer', 'senior_dev_pm'
from auth.users
where email = 'senior@test.com';