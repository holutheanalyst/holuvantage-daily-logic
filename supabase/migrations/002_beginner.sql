-- Adds the 4x4 Beginner difficulty.
alter table public.daily_puzzles drop constraint if exists daily_puzzles_difficulty_check;
alter table public.daily_puzzles add constraint daily_puzzles_difficulty_check check (difficulty in ('beginner','easy','medium','hard'));
