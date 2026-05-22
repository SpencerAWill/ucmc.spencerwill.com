-- Seed the historical-officers archive and honorary-members list from
-- the legacy ucmountaineering.weebly.com site. Preserves the source
-- data verbatim, including "Unknown" / "X" placeholders, mid-year
-- transitions encoded as "Name A / Name B" or "Name A & Name B", and
-- combined Secretary/Treasurer rows in early years before those roles
-- split. Free-form role text matches each year's actual title, not
-- today's role set.
--
-- role_order convention (intra-year display order):
--   1 = President
--   2 = Vice-President
--   3 = Treasurer / Secretary-Treasurer (combined)
--   4 = Secretary
--   5 = Trip Coordinator
--   6 = Equipment Manager / Gear Manager
--   7 = Gear Assistants
--   8 = Librarian

INSERT OR IGNORE INTO historical_officers (school_year, start_year, role, role_order, name) VALUES
  -- 1973-74
  ('1973-74', 1973, 'President', 1, 'Matt Kluesner'),
  ('1973-74', 1973, 'Secretary/Treasurer', 3, 'Steve'),
  ('1973-74', 1973, 'Librarian', 8, 'X'),
  ('1973-74', 1973, 'Equipment Manager', 6, 'Unknown'),
  -- 1974-75
  ('1974-75', 1974, 'President', 1, 'Bruce Periano'),
  ('1974-75', 1974, 'Secretary/Treasurer', 3, 'Unknown'),
  ('1974-75', 1974, 'Librarian', 8, 'X'),
  ('1974-75', 1974, 'Equipment Manager', 6, 'Unknown'),
  -- 1975-76
  ('1975-76', 1975, 'President', 1, 'Tom Simpson'),
  ('1975-76', 1975, 'Secretary/Treasurer', 3, 'Bill Strachan'),
  ('1975-76', 1975, 'Librarian', 8, 'X'),
  ('1975-76', 1975, 'Equipment Manager', 6, 'Roland Engerbretsen'),
  -- 1976-77
  ('1976-77', 1976, 'President', 1, 'Hal Shaw'),
  ('1976-77', 1976, 'Secretary/Treasurer', 3, 'Dave Havlan'),
  ('1976-77', 1976, 'Librarian', 8, 'X'),
  ('1976-77', 1976, 'Equipment Manager', 6, 'Tom Simpson'),
  -- 1977-78
  ('1977-78', 1977, 'President', 1, 'Mark Hartinger'),
  ('1977-78', 1977, 'Secretary/Treasurer', 3, 'Bob Kessler'),
  ('1977-78', 1977, 'Librarian', 8, 'X'),
  ('1977-78', 1977, 'Equipment Manager', 6, 'Tom Simpson'),
  -- 1978-79
  ('1978-79', 1978, 'President', 1, 'Mark Hartinger'),
  ('1978-79', 1978, 'Secretary/Treasurer', 3, 'Bob Kessler'),
  ('1978-79', 1978, 'Librarian', 8, 'Kathy Murphy'),
  ('1978-79', 1978, 'Equipment Manager', 6, 'Tom Simpson'),
  -- 1979-80
  ('1979-80', 1979, 'President', 1, 'Jane Rielly'),
  ('1979-80', 1979, 'Secretary/Treasurer', 3, 'Dan Lynch'),
  ('1979-80', 1979, 'Librarian', 8, 'Kathy Murphy'),
  ('1979-80', 1979, 'Equipment Manager', 6, 'Bruce Williams'),
  -- 1980-81
  ('1980-81', 1980, 'President', 1, 'Marty Huesman'),
  ('1980-81', 1980, 'Secretary/Treasurer', 3, 'Dave Weber'),
  ('1980-81', 1980, 'Librarian', 8, 'Cindy Mason'),
  ('1980-81', 1980, 'Equipment Manager', 6, 'Chris Rathweg'),
  -- 1981-82
  ('1981-82', 1981, 'President', 1, 'Dan Lynch'),
  ('1981-82', 1981, 'Vice-President', 2, 'Suzanne Workman'),
  ('1981-82', 1981, 'Treasurer', 3, 'Fletch Andrews'),
  ('1981-82', 1981, 'Librarian', 8, 'Sharon McDaniels'),
  ('1981-82', 1981, 'Equipment Manager', 6, 'Steve Kramrech'),
  -- 1982-83
  ('1982-83', 1982, 'President', 1, 'Fletch Andrews'),
  ('1982-83', 1982, 'Vice-President', 2, 'Tom Bailey'),
  ('1982-83', 1982, 'Treasurer', 3, 'Brenda Domingus'),
  ('1982-83', 1982, 'Librarian', 8, 'Mike Davis'),
  ('1982-83', 1982, 'Equipment Manager', 6, 'Greg Rolfes'),
  -- 1983-84
  ('1983-84', 1983, 'President', 1, 'Tom Bailey (Fall) / Steve Kramrech'),
  ('1983-84', 1983, 'Vice-President', 2, 'Greg Rolfes'),
  ('1983-84', 1983, 'Treasurer', 3, 'Marci Napoli'),
  ('1983-84', 1983, 'Librarian', 8, 'Monica Thielman'),
  ('1983-84', 1983, 'Equipment Manager', 6, 'Karen Riggs'),
  -- 1984-85
  ('1984-85', 1984, 'President', 1, 'Marci Napoli'),
  ('1984-85', 1984, 'Vice-President', 2, 'Jeff Cousins'),
  ('1984-85', 1984, 'Treasurer', 3, 'Karen Riggs'),
  ('1984-85', 1984, 'Librarian', 8, 'Unknown'),
  ('1984-85', 1984, 'Equipment Manager', 6, 'Mark Miller'),
  -- 1985-86
  ('1985-86', 1985, 'President', 1, 'Karen Riggs'),
  ('1985-86', 1985, 'Vice-President', 2, 'Allen Sutherland'),
  ('1985-86', 1985, 'Treasurer', 3, 'Steve Must'),
  ('1985-86', 1985, 'Librarian', 8, 'Rodger Bloom'),
  ('1985-86', 1985, 'Equipment Manager', 6, 'Steve Kramrech'),
  -- 1986-87
  ('1986-87', 1986, 'President', 1, 'Dennis Dziech / Steve Must'),
  ('1986-87', 1986, 'Vice-President', 2, 'Jeff Streba'),
  ('1986-87', 1986, 'Treasurer', 3, 'Steve Must / Steve Nieman'),
  ('1986-87', 1986, 'Librarian', 8, 'Unknown'),
  ('1986-87', 1986, 'Equipment Manager', 6, 'Mark Guttadauro'),
  -- 1987-88
  ('1987-88', 1987, 'President', 1, 'Mark Suer'),
  ('1987-88', 1987, 'Vice-President', 2, 'Nick Day'),
  ('1987-88', 1987, 'Treasurer', 3, 'Steve Nieman'),
  ('1987-88', 1987, 'Librarian', 8, 'Jan True'),
  ('1987-88', 1987, 'Equipment Manager', 6, 'Mark Guttadauro'),
  -- 1988-89
  ('1988-89', 1988, 'President', 1, 'Jerry Bargo'),
  ('1988-89', 1988, 'Vice-President', 2, 'Phil Wilkin'),
  ('1988-89', 1988, 'Treasurer', 3, 'Steve Nieman'),
  ('1988-89', 1988, 'Equipment Manager', 6, 'Mark Guttadauro'),
  -- 1989-90
  ('1989-90', 1989, 'President', 1, 'Carl Bolyard'),
  ('1989-90', 1989, 'Vice-President', 2, 'Matt Rein'),
  ('1989-90', 1989, 'Treasurer', 3, 'Beth Remer'),
  ('1989-90', 1989, 'Equipment Manager', 6, 'Phil Wilkin'),
  -- 1990-91
  ('1990-91', 1990, 'President', 1, 'Jerry Bargo'),
  ('1990-91', 1990, 'Vice-President', 2, 'Phil Wilkin'),
  ('1990-91', 1990, 'Treasurer', 3, 'Matt Lehr'),
  ('1990-91', 1990, 'Equipment Manager', 6, 'Jim Wilhelm'),
  -- 1991-92
  ('1991-92', 1991, 'President', 1, 'Melissa Bailey'),
  ('1991-92', 1991, 'Vice-President', 2, 'Ed Schulte'),
  ('1991-92', 1991, 'Treasurer', 3, 'Mike Schirmer'),
  ('1991-92', 1991, 'Equipment Manager', 6, 'Jim Wilhelm'),
  -- 1992-93
  ('1992-93', 1992, 'President', 1, 'Lara Hugenberg'),
  ('1992-93', 1992, 'Vice-President', 2, 'Ed Schulte'),
  ('1992-93', 1992, 'Treasurer', 3, 'Ken Osborn'),
  ('1992-93', 1992, 'Equipment Manager', 6, 'Jim Wilhelm'),
  -- 1993-94
  ('1993-94', 1993, 'President', 1, 'Joe Lampe'),
  ('1993-94', 1993, 'Vice-President', 2, 'Jim Wilhelm'),
  ('1993-94', 1993, 'Treasurer', 3, 'Dorsey Chappelear'),
  ('1993-94', 1993, 'Equipment Manager', 6, 'Jeremy Sibert'),
  -- 1994-95
  ('1994-95', 1994, 'President', 1, 'Brad Libby'),
  ('1994-95', 1994, 'Vice-President', 2, 'Jay Gibson'),
  ('1994-95', 1994, 'Treasurer', 3, 'Shannon Hagar'),
  ('1994-95', 1994, 'Equipment Manager', 6, 'Jeremy Sibert'),
  -- 1995-96
  ('1995-96', 1995, 'President', 1, 'Jay Gibson'),
  ('1995-96', 1995, 'Vice-President', 2, 'Sarah Grey'),
  ('1995-96', 1995, 'Treasurer', 3, 'Dave Core'),
  ('1995-96', 1995, 'Equipment Manager', 6, 'Jeremy Sibert'),
  -- 1996-97
  ('1996-97', 1996, 'President', 1, 'Jeremy Sibert'),
  ('1996-97', 1996, 'Vice-President', 2, 'Amy Kindell'),
  ('1996-97', 1996, 'Treasurer', 3, 'Matt Kappen'),
  ('1996-97', 1996, 'Equipment Manager', 6, 'Bob Mouk'),
  -- 1997-98
  ('1997-98', 1997, 'President', 1, 'Jeremy Sibert'),
  ('1997-98', 1997, 'Vice-President', 2, 'Annelies Koob'),
  ('1997-98', 1997, 'Treasurer', 3, 'Matt Kappen'),
  ('1997-98', 1997, 'Equipment Manager', 6, 'Bob Mouk'),
  -- 1998-99
  ('1998-99', 1998, 'President', 1, 'Annelies Koob / Matt Kappen'),
  ('1998-99', 1998, 'Vice-President', 2, 'Robert Sexton'),
  ('1998-99', 1998, 'Treasurer', 3, 'Jim Wilhelm'),
  ('1998-99', 1998, 'Equipment Manager', 6, 'Ted Roll'),
  -- 1999-00
  ('1999-00', 1999, 'President', 1, 'Renee Ford'),
  ('1999-00', 1999, 'Vice-President', 2, 'Ted Roll'),
  ('1999-00', 1999, 'Treasurer', 3, 'Robert Sexton'),
  ('1999-00', 1999, 'Equipment Manager', 6, 'Annelies Koob / Jennifer Goings'),
  -- 2000-01
  ('2000-01', 2000, 'President', 1, 'Renee Ford / Stacy Dunn'),
  ('2000-01', 2000, 'Vice-President', 2, 'Matt Williams / Leisa Eidson'),
  ('2000-01', 2000, 'Treasurer', 3, 'Peter Hogaboam'),
  ('2000-01', 2000, 'Equipment Manager', 6, 'Jeff Hylok'),
  -- 2001-02
  ('2001-02', 2001, 'President', 1, 'Justin Peter'),
  ('2001-02', 2001, 'Vice-President', 2, 'Stacy Dunn / Laura Vogel'),
  ('2001-02', 2001, 'Treasurer', 3, 'Robert Sexton'),
  ('2001-02', 2001, 'Equipment Manager', 6, 'Ben Slesinger (Summer) / Jeff Hylok'),
  -- 2002-03
  ('2002-03', 2002, 'President', 1, 'Tyler Kobsek'),
  ('2002-03', 2002, 'Vice-President', 2, 'Laura Vogel'),
  ('2002-03', 2002, 'Treasurer', 3, 'Robert Sexton'),
  ('2002-03', 2002, 'Equipment Manager', 6, 'Bob Mouk / Justin Peter'),
  -- 2003-04
  ('2003-04', 2003, 'President', 1, 'Laura Vogel'),
  ('2003-04', 2003, 'Vice-President', 2, 'Haley Buffman'),
  ('2003-04', 2003, 'Treasurer', 3, 'Marty Crawford'),
  ('2003-04', 2003, 'Equipment Manager', 6, 'Joe Gayetsky'),
  -- 2004-05
  ('2004-05', 2004, 'President', 1, 'Marty Crawford'),
  ('2004-05', 2004, 'Vice-President', 2, 'Laura Rigrish / Joe Gayetsky'),
  ('2004-05', 2004, 'Treasurer', 3, 'Rob Laing'),
  ('2004-05', 2004, 'Equipment Manager', 6, 'Kevin Crawford'),
  -- 2005-06
  ('2005-06', 2005, 'President', 1, 'Scott Robinson'),
  ('2005-06', 2005, 'Vice-President', 2, 'David Fryauff'),
  ('2005-06', 2005, 'Treasurer', 3, 'Ben Strasinger'),
  ('2005-06', 2005, 'Secretary', 4, 'Emily Stover'),
  ('2005-06', 2005, 'Equipment Manager', 6, 'Unknown'),
  -- 2006-07
  ('2006-07', 2006, 'President', 1, 'David Fryauff'),
  ('2006-07', 2006, 'Vice-President', 2, 'Emily Stover'),
  ('2006-07', 2006, 'Treasurer', 3, 'Unknown'),
  ('2006-07', 2006, 'Secretary', 4, 'Unknown'),
  ('2006-07', 2006, 'Equipment Manager', 6, 'Unknown'),
  -- 2007-08
  ('2007-08', 2007, 'President', 1, 'Emily Stover'),
  ('2007-08', 2007, 'Vice-President', 2, 'Mike Kuhlmann / Diana Hsieh'),
  ('2007-08', 2007, 'Treasurer', 3, 'Mike Kuhlmann'),
  ('2007-08', 2007, 'Secretary', 4, 'Unknown'),
  ('2007-08', 2007, 'Equipment Manager', 6, 'Diana Hsieh, David Fryauff'),
  -- 2008-09
  ('2008-09', 2008, 'President', 1, 'Zach Kier'),
  ('2008-09', 2008, 'Vice-President', 2, 'Diana Hsieh'),
  ('2008-09', 2008, 'Treasurer', 3, 'Lee Sekinger'),
  ('2008-09', 2008, 'Secretary', 4, 'Ellen Collins'),
  ('2008-09', 2008, 'Equipment Manager', 6, 'Diana Hsieh, Mike Hemmerle'),
  -- 2009-10
  ('2009-10', 2009, 'President', 1, 'Diana Hsieh'),
  ('2009-10', 2009, 'Vice-President', 2, 'Sean Goss'),
  ('2009-10', 2009, 'Treasurer', 3, 'Lee Sekinger'),
  ('2009-10', 2009, 'Secretary', 4, 'Ellen Collins'),
  ('2009-10', 2009, 'Equipment Manager', 6, 'Tony Snook, Nick Bose'),
  -- 2010-11
  ('2010-11', 2010, 'President', 1, 'Lee Sekinger'),
  ('2010-11', 2010, 'Vice-President', 2, 'Tess Piening'),
  ('2010-11', 2010, 'Treasurer', 3, 'Alex Ping'),
  ('2010-11', 2010, 'Secretary', 4, 'Page Kagafas'),
  ('2010-11', 2010, 'Equipment Manager', 6, 'Nick Bose, Tony Snook'),
  -- 2011-12
  ('2011-12', 2011, 'President', 1, 'Dirk Frey / Vinnie Valentino'),
  ('2011-12', 2011, 'Vice-President', 2, 'Page Kagafas / Vinnie Valentino'),
  ('2011-12', 2011, 'Treasurer', 3, 'Alex Mitchell'),
  ('2011-12', 2011, 'Secretary', 4, 'Vinnie Valentino / Adam White'),
  ('2011-12', 2011, 'Equipment Manager', 6, 'Tim Roetting, Ron Gillespie'),
  -- 2012-13
  ('2012-13', 2012, 'President', 1, 'Megan Chambers'),
  ('2012-13', 2012, 'Vice-President', 2, 'Charles Marxen / Crosley Brammer'),
  ('2012-13', 2012, 'Treasurer', 3, 'Jacob Ellis'),
  ('2012-13', 2012, 'Secretary', 4, 'Taylor Griggs'),
  ('2012-13', 2012, 'Equipment Manager', 6, 'Tim Roetting, Carter Harlan'),
  -- 2013-14
  ('2013-14', 2013, 'President', 1, 'Taylor Griggs / Carter Harlan'),
  ('2013-14', 2013, 'Vice-President', 2, 'Carter Harlan / Chuck Marxen'),
  ('2013-14', 2013, 'Treasurer', 3, 'Felicia Brugger'),
  ('2013-14', 2013, 'Secretary', 4, 'Ellen Foster'),
  ('2013-14', 2013, 'Equipment Manager', 6, 'Tim Roetting, Alex Dziech, Mitch Kleimeyer, Adam White'),
  -- 2014-15
  ('2014-15', 2014, 'President', 1, 'Kayla McKinney'),
  ('2014-15', 2014, 'Vice-President', 2, 'Zach Altman'),
  ('2014-15', 2014, 'Treasurer', 3, 'Jake Brown'),
  ('2014-15', 2014, 'Secretary', 4, 'Cameron Uptmor'),
  ('2014-15', 2014, 'Trip Coordinator', 5, 'Adam White / Jack Barendt'),
  ('2014-15', 2014, 'Equipment Manager', 6, 'Tim Roetting, Alex Dziech, Mitch Kleimeyer'),
  -- 2015-16
  ('2015-16', 2015, 'President', 1, 'Jacob Schutt'),
  ('2015-16', 2015, 'Vice-President', 2, 'Jack Barendt'),
  ('2015-16', 2015, 'Treasurer', 3, 'Cameron Uptmor'),
  ('2015-16', 2015, 'Secretary', 4, 'Nadia Nutgrass'),
  ('2015-16', 2015, 'Trip Coordinator', 5, 'Dustin Kisner'),
  ('2015-16', 2015, 'Equipment Manager', 6, 'Jake Brown'),
  -- 2016-17
  ('2016-17', 2016, 'President', 1, 'Cameron Uptmor'),
  ('2016-17', 2016, 'Vice-President', 2, 'Dustin Kisner'),
  ('2016-17', 2016, 'Treasurer', 3, 'Sam Payne'),
  ('2016-17', 2016, 'Secretary', 4, 'Ben Hoffman / Sarah Brokamp'),
  ('2016-17', 2016, 'Trip Coordinator', 5, 'Jake Sekinger / Nate Jung'),
  ('2016-17', 2016, 'Equipment Manager', 6, 'Tim Roetting / Brett Hochman'),
  ('2016-17', 2016, 'Gear Assistants', 7, 'Chloe Rensing, Ethan Heald, Tina McGovern'),
  -- 2017-18
  ('2017-18', 2017, 'President', 1, 'Dustin Kisner'),
  ('2017-18', 2017, 'Vice-President', 2, 'Sarah Brokamp'),
  ('2017-18', 2017, 'Treasurer', 3, 'Kayla Drager'),
  ('2017-18', 2017, 'Secretary', 4, 'Katie Cavanaugh / Jake Sekinger'),
  ('2017-18', 2017, 'Trip Coordinator', 5, 'Ben Shaw / Wil Talbott'),
  ('2017-18', 2017, 'Equipment Manager', 6, 'Brett Hochman'),
  ('2017-18', 2017, 'Gear Assistants', 7, 'Lydia Wine, Brooke Proch, Sean Weddell, Matt Maertz, Sophia Privitera, Joe Carver'),
  -- 2018-19
  ('2018-19', 2018, 'President', 1, 'Ben Shaw'),
  ('2018-19', 2018, 'Vice-President', 2, 'Jake Sekinger'),
  ('2018-19', 2018, 'Treasurer', 3, 'Lizzie Mosier'),
  ('2018-19', 2018, 'Secretary', 4, 'Austin Vessley / Katrina Zielonka'),
  ('2018-19', 2018, 'Trip Coordinator', 5, 'Matt Maertz / Dalton Spurlin'),
  ('2018-19', 2018, 'Equipment Manager', 6, 'Brett Hochman'),
  ('2018-19', 2018, 'Gear Assistants', 7, 'Lydia Wine, Brooke Proch, Joe Carver, Sophia Privitera, Sean Weddell'),
  -- 2019-20
  ('2019-20', 2019, 'President', 1, 'Lizzie Mosier & Dalton Spurlin'),
  ('2019-20', 2019, 'Vice-President', 2, 'Joe Carver'),
  ('2019-20', 2019, 'Treasurer', 3, 'Katie Cavanaugh'),
  ('2019-20', 2019, 'Secretary', 4, 'Maya Guevara / Fred Schroeder'),
  ('2019-20', 2019, 'Trip Coordinator', 5, 'Dillan Maloney / Alexa Olic'),
  ('2019-20', 2019, 'Equipment Manager', 6, 'Brett Hochman'),
  ('2019-20', 2019, 'Gear Assistants', 7, 'Lydia Wine, Brooke Proch, Matt Maertz, Sophia Privitera, Sean Weddell'),
  -- 2020-21
  ('2020-21', 2020, 'President', 1, 'Dillan Maloney'),
  ('2020-21', 2020, 'Vice-President', 2, 'Emily Hannan'),
  ('2020-21', 2020, 'Treasurer', 3, 'Deyer Graffice'),
  ('2020-21', 2020, 'Secretary', 4, 'Alexa Olic / Daniel Posmik'),
  ('2020-21', 2020, 'Trip Coordinator', 5, 'Rob Olszewski'),
  ('2020-21', 2020, 'Equipment Manager', 6, 'Joe Carver / Ben Shaw'),
  ('2020-21', 2020, 'Gear Assistants', 7, 'Lydia Wine, Brooke Proch, Matt Maertz, Sophia Privitera, Cody Kisner'),
  -- 2021-22
  ('2021-22', 2021, 'President', 1, 'Rob Olszewski'),
  ('2021-22', 2021, 'Vice-President', 2, 'Deyer Graffice'),
  ('2021-22', 2021, 'Treasurer', 3, 'Daniel Maertz'),
  ('2021-22', 2021, 'Secretary', 4, 'Liz Woodruff / Alyssa Polito'),
  ('2021-22', 2021, 'Trip Coordinator', 5, 'Karoline Smith'),
  ('2021-22', 2021, 'Equipment Manager', 6, 'Cody Kisner / Emily Hannan'),
  ('2021-22', 2021, 'Gear Assistants', 7, 'Max Lackey, Autumn Combs, Trevor Darst'),
  -- 2022-23
  ('2022-23', 2022, 'President', 1, 'Deyer Graffice & Alyssa Polito'),
  ('2022-23', 2022, 'Vice-President', 2, 'Trevor Darst'),
  ('2022-23', 2022, 'Treasurer', 3, 'Ian Wright'),
  ('2022-23', 2022, 'Secretary', 4, 'Miranda Sharer / Gabrielle Griffith'),
  ('2022-23', 2022, 'Trip Coordinator', 5, 'Nick Murphy'),
  ('2022-23', 2022, 'Equipment Manager', 6, 'Cody Kisner / Emily Hannan'),
  ('2022-23', 2022, 'Gear Assistants', 7, 'Max Lackey, Autumn Combs');
--> statement-breakpoint

INSERT OR IGNORE INTO honorary_members (name, sort_order) VALUES
  ('Linda Henneman', 1),
  ('Roland Engebretsen', 2),
  ('Jim Wilhelm', 3),
  ('Annelies Koob', 4),
  ('Nate Pfeffer', 5),
  ('Dan Galbraith', 6),
  ('Gretchen Brewer', 7),
  ('Bob Kessler', 8),
  ('Alan Sutherland', 9),
  ('Jeremy Sibert', 10),
  ('Tim Doyle', 11),
  ('Rob Even', 12),
  ('Bruce Perriano', 13),
  ('Rick Forrester', 14),
  ('Don Speller', 15),
  ('Steve Must', 16),
  ('Emily Stover', 17),
  ('Nate Schneider', 18),
  ('Bill Strachan', 19),
  ('Jane Rielly', 20),
  ('Mark Guttaduaro', 21),
  ('Bob Mouk', 22),
  ('Lee Sekinger', 23),
  ('Brett Hochman', 24),
  ('Mark Hartinger', 25),
  ('Tom Simpson', 26),
  ('Steve Kramrech', 27),
  ('Steve Nieman', 28),
  ('Larry Bortner', 29),
  ('Marc Junger', 30),
  ('Matt Kluesner', 31),
  ('Dan Lynch', 32),
  ('Jerry Bargo', 33),
  ('Matthew Kappen', 34),
  ('Tim Roetting', 35),
  ('Gary Reckelhoff', 36);
