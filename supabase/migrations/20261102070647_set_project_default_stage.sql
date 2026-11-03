-- New projects start at Discovery (PROJ-02)
alter table projects alter column stage set default 'discovery';

-- Move existing projects still at the old starting stage
update projects set stage = 'discovery' where stage = 'create_project';