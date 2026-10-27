create extension if not exists btree_gist;
create table if not exists users(
  id serial primary key, email text unique not null, password_hash text not null, name text not null,
  role text not null check (role in ('admin','md','receptionist','staff','guest')), created_at timestamptz default now());
create table if not exists rooms(
  id serial primary key, number text unique not null, category text not null, price_ngn int not null check (price_ngn>=0),
  note text default '', photo_url text default '', active boolean default true);
create table if not exists venues(
  id serial primary key, name text unique not null, description text default '');
insert into venues(name,description) values
 ('Event Center','Weddings, receptions, parties and large gatherings'),
 ('Event Planning Center','Planning consultations, decor and event coordination'),
 ('Conference Room','Meetings, trainings, seminars and workshops') on conflict do nothing;
create table if not exists bookings(
  id serial primary key, ref text unique not null, user_id int references users(id) on delete set null,
  kind text not null check (kind in ('room','venue')), category text,
  room_id int references rooms(id), venue_id int references venues(id),
  check_in date not null, check_out date not null, start_time time, end_time time,
  guests int not null default 1 check (guests between 1 and 2000),
  guest_name text not null, guest_email text not null, phone text not null, note text default '',
  status text not null default 'pending' check (status in ('pending','confirmed','declined','checked_in','cancelled')),
  handled_by int references users(id), handled_at timestamptz, created_at timestamptz default now(),
  check (check_out>check_in),
  constraint no_room_overlap exclude using gist (room_id with =, daterange(check_in,check_out,'[)') with &&)
    where (status in ('confirmed','checked_in') and room_id is not null),
  constraint no_venue_overlap exclude using gist (venue_id with =, daterange(check_in,check_out,'[)') with &&)
    where (status in ('confirmed','checked_in') and venue_id is not null));
create index if not exists bookings_status_created on bookings(status,created_at);
create table if not exists employees(
  id serial primary key, verification_code text unique not null, user_id int unique references users(id) on delete set null,
  full_name text not null, job_title text not null, sector text not null,
  account_role text not null default 'staff' check (account_role in ('staff','receptionist','md')),
  shift_days text default '', shift_start time, shift_end time, phone text default '', address text default '', emergency_contact text default '',
  created_by int references users(id) on delete set null, created_at timestamptz default now(), claimed_at timestamptz);
create table if not exists notices(
  id serial primary key, author_id int references users(id) on delete set null, title text not null, body text not null,
  audience text not null check (audience in ('all','staff','guests','sector')), sector text, created_at timestamptz default now());
create table if not exists messages(
  id serial primary key, from_user int not null references users(id) on delete cascade, to_user int not null references users(id) on delete cascade,
  body text not null, created_at timestamptz default now(), read_at timestamptz);
create index if not exists messages_pair on messages(from_user,to_user,created_at);
create table if not exists enquiries(
  id serial primary key, name text not null, phone text not null, email text default '', message text not null, created_at timestamptz default now());
alter table rooms add column if not exists hk_status text not null default 'clean';
alter table bookings add column if not exists amount_ngn int not null default 0;
alter table bookings add column if not exists paid_ngn int not null default 0;
create table if not exists payments(
  id serial primary key, booking_id int not null references bookings(id) on delete cascade, reference text unique not null,
  amount_ngn int not null, status text not null default 'pending' check (status in ('pending','success','failed')),
  channel text not null default 'paystack', created_at timestamptz default now(), paid_at timestamptz);
create table if not exists sector_items(
  id serial primary key, sector text not null, kind text not null, title text not null, details text default '',
  status text not null default 'open' check (status in ('open','in_progress','done')), room_number text,
  created_by int references users(id) on delete set null, created_at timestamptz default now(), updated_at timestamptz default now());
create index if not exists sector_items_sector on sector_items(sector,status,created_at);
