-- 0090_sanitary_route_intranasal.sql
-- Agrega 'intranasal' al enum public.sanitary_route (0027). Vía real de vacunas respiratorias
-- vivas en bovinos (IBR/BRSV/PI3). El selector de vacunación lo ofrece como 3ra vía curada.
alter type public.sanitary_route add value if not exists 'intranasal';
notify pgrst, 'reload schema';
